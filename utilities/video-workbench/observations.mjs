/** Unfiltered eye features, event encoding and per-session calibration. */
const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const median = (a) => {
  const b = a.filter(finite).sort((x, y) => x - y);
  return b.length
    ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2
    : null;
};
export function irisFeatures(points, metrics, width, height) {
  if ((metrics?.blinkLeft ?? 0) > 0.4 || (metrics?.blinkRight ?? 0) > 0.4)
    return null;
  const eyes = [];
  for (const [a, b, t, d, c] of [
    [33, 133, 159, 145, 468],
    [362, 263, 386, 374, 473],
  ]) {
    if (
      ![a, b, t, d, c].every(
        (i) =>
          points[i] &&
          finite(points[i].x) &&
          finite(points[i].y) &&
          points[i].x >= 0 &&
          points[i].x <= 1 &&
          points[i].y >= 0 &&
          points[i].y <= 1,
      )
    )
      return null;
    let A = { x: points[a].x * width, y: points[a].y * height },
      B = { x: points[b].x * width, y: points[b].y * height };
    if (A.x > B.x) [A, B] = [B, A];
    const dx = B.x - A.x,
      dy = B.y - A.y,
      w = Math.hypot(dx, dy);
    if (
      w < 4 ||
      Math.hypot(
        (points[t].x - points[d].x) * width,
        (points[t].y - points[d].y) * height,
      ) /
        w <
        0.08
    )
      return null;
    const ix = points[c].x * width - (A.x + B.x) / 2,
      iy = points[c].y * height - (A.y + B.y) / 2;
    const x = (ix * dx + iy * dy) / (w * w),
      y = (-ix * dy + iy * dx) / (w * w);
    if (Math.abs(x) > 0.7 || Math.abs(y) > 0.5) return null;
    eyes.push({
      x,
      y,
      cx: (A.x + B.x) / 2 / width,
      cy: (A.y + B.y) / 2 / height,
      w: w / width,
    });
  }
  const irisX = (eyes[0].x + eyes[1].x) / 2,
    irisY = (eyes[0].y + eyes[1].y) / 2;
  return {
    irisX,
    irisY,
    vector: [
      irisX,
      irisY,
      (eyes[0].cx + eyes[1].cx) / 2,
      (eyes[0].cy + eyes[1].cy) / 2,
      (eyes[0].w + eyes[1].w) / 2,
    ],
  };
}
export function encodeBlinks(rows, maxGap = 0.2) {
  const events = [],
    states = [];
  let active = null,
    last = null,
    previousOpen = false;
  const end = (offset, complete, reason) => {
    if (!active) return;
    const duration = Math.max(0, offset - active.onset);
    events.push({
      ...active,
      offset,
      duration,
      complete: complete && active.observedOpenBefore,
      reason: active.observedOpenBefore ? reason : "starts_closed",
      kind: duration > 1 ? "eye_closure" : "blink",
    });
    active = null;
  };
  for (const row of rows) {
    if (last !== null && row.time - last > maxGap) {
      end(last, false, "sampling_gap");
      previousOpen = false;
    }
    const left = row.metrics?.blinkLeft,
      right = row.metrics?.blinkRight;
    if (!finite(left) || !finite(right)) {
      end(last ?? row.time, false, "missing_detection");
      states.push(null);
      previousOpen = false;
      last = row.time;
      continue;
    }
    const closed = Math.min(left, right),
      open = Math.max(left, right) <= 0.3;
    if (!active && closed >= 0.6)
      active = {
        onset: row.time,
        peak: closed,
        observedOpenBefore: previousOpen,
      };
    if (active) active.peak = Math.max(active.peak, closed);
    if (active && open) end(row.time, true, "reopened");
    states.push(active ? 1 : 0);
    if (open) previousOpen = true;
    last = row.time;
  }
  end(last ?? 0, false, "end_of_segment");
  return { events, states };
}
function solve(matrix, rhs) {
  const a = matrix.map((r, i) => [...r, rhs[i]]),
    n = rhs.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let j = k + 1; j < n; j++)
      if (Math.abs(a[j][k]) > Math.abs(a[pivot][k])) pivot = j;
    if (Math.abs(a[pivot][k]) < 1e-10) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const v = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= v;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const v = a[i][k];
        for (let j = k; j <= n; j++) a[i][j] -= v * a[k][j];
      }
  }
  return a.map((r) => r[n]);
}
export function fitGaze(observations) {
  if (
    observations.length < 27 ||
    !observations.every(
      (o) => o.features?.length === 5 && o.features.every(finite),
    )
  )
    return null;
  const n = observations.length,
    means = Array.from(
      { length: 5 },
      (_, j) => observations.reduce((a, o) => a + o.features[j], 0) / n,
    );
  const spreads = means.map((m, j) =>
    Math.sqrt(
      observations.reduce((a, o) => a + (o.features[j] - m) ** 2, 0) / n,
    ),
  );
  if (spreads[0] < 0.003 || spreads[1] < 0.003) return null;
  const scales = spreads.map((s) => Math.max(s, 0.001));
  const rows = observations.map((o) => [
    1,
    ...o.features.map((v, j) => (v - means[j]) / scales[j]),
  ]);
  const matrix = Array.from({ length: 6 }, (_, i) =>
    Array.from(
      { length: 6 },
      (_, j) =>
        rows.reduce((s, r) => s + r[i] * r[j], 0) +
        (i === j && i > 0 ? 0.01 * n : 0),
    ),
  );
  const coefficients = ["x", "y"].map((axis) =>
    solve(
      matrix,
      Array.from({ length: 6 }, (_, j) =>
        rows.reduce((s, r, i) => s + r[j] * observations[i].target[axis], 0),
      ),
    ),
  );
  if (coefficients.some((c) => !c || !c.every(finite))) return null;
  return {
    method: "standardized_ridge",
    means,
    scales,
    coefficients,
    regularization: 0.01,
    temporalFilter: "none",
  };
}
export function predictGaze(model, features) {
  if (!model || !features || features.length !== 5 || !features.every(finite))
    return null;
  // Head position/size changes beyond the calibration envelope invalidate a prediction.
  if (
    features.some(
      (v, j) =>
        j >= 2 &&
        Math.abs(v - model.means[j]) > Math.max(0.06, model.scales[j] * 4),
    )
  )
    return null;
  const row = [
    1,
    ...features.map((v, j) => (v - model.means[j]) / model.scales[j]),
  ];
  const [x, y] = model.coefficients.map((c) =>
    c.reduce((s, v, j) => s + v * row[j], 0),
  );
  return finite(x) &&
    finite(y) &&
    x >= -0.25 &&
    x <= 1.25 &&
    y >= -0.25 &&
    y <= 1.25
    ? { x, y, inScreen: x >= 0 && x <= 1 && y >= 0 && y <= 1 }
    : null;
}
export function validateGaze(model, observations) {
  const predictions = observations.map((o) => ({
    target: o.target,
    prediction: predictGaze(model, o.features),
  }));
  const errors = predictions.map((o) =>
    o.prediction
      ? Math.hypot(o.prediction.x - o.target.x, o.prediction.y - o.target.y)
      : 1,
  );
  const meanError = errors.length
    ? errors.reduce((a, b) => a + b, 0) / errors.length
    : null;
  const groups = new Map();
  predictions.forEach((p, i) => {
    const key = `${p.target.x},${p.target.y}`;
    groups.set(key, [...(groups.get(key) ?? []), errors[i]]);
  });
  const worstTarget = groups.size
    ? Math.max(...[...groups.values()].map(median))
    : null;
  return {
    accepted:
      groups.size >= 4 &&
      finite(meanError) &&
      meanError <= 0.15 &&
      worstTarget <= 0.25,
    meanError,
    worstTarget,
    predictions,
  };
}
export function neutralReference(rows, scale = 1) {
  if (rows.length < 5 || rows.at(-1).time - rows[0].time < 0.5) return null;
  const values = {},
    spread = {};
  for (const key of [
    "headRoll",
    "shoulderTilt",
    "torsoLean",
    "torsoLeanEstimated",
    "lipAperture",
    "mouthWidth",
    "lowerLipY",
    "jawY",
  ]) {
    const v = rows
      .map((r) => r.metrics?.[key])
      .filter(finite)
      .sort((a, b) => a - b);
    if (v.length < 5 || v.length < rows.length * 0.7) continue;
    const range =
      v[Math.floor((v.length - 1) * 0.9)] - v[Math.floor((v.length - 1) * 0.1)];
    if (
      range >
      (["headRoll", "shoulderTilt", "torsoLean", "torsoLeanEstimated"].includes(
        key,
      )
        ? 6
        : 0.08 * scale)
    )
      continue;
    values[key] = median(v);
    spread[key] = range;
  }
  return Object.keys(values).length
    ? {
        values,
        spread,
        samples: rows.length,
        start: rows[0].time,
        end: rows.at(-1).time,
        method: "median_neutral_reference",
      }
    : null;
}
export function relativeMetrics(metrics, baseline) {
  const derived = {};
  for (const [key, value] of Object.entries(baseline?.values ?? {}))
    derived[`${key}Relative`] = finite(metrics?.[key])
      ? metrics[key] - value
      : null;
  return derived;
}
