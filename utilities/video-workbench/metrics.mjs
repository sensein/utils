/** Pure, browser-independent measurements. Coordinates use image pixels before normalization. */
const valid = (v) => typeof v === "number" && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function faceMetrics(
  points,
  categories,
  width,
  height,
  eyeDistance = null,
) {
  const ids = [33, 263, 13, 14, 61, 291, 152];
  if (!ids.every((i) => points[i] && valid(points[i].x) && valid(points[i].y)))
    return null;
  const px = (i) => ({ x: points[i].x * width, y: points[i].y * height });
  const a = px(33),
    b = px(263),
    d = distance(a, b);
  if (d < 1e-6) return null;
  const factor = valid(eyeDistance) && eyeDistance > 0 ? eyeDistance : 1;
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const localY = (i) =>
    (((px(i).y - c.y) * (b.x - a.x) - (px(i).x - c.x) * (b.y - a.y)) / d / d) *
    factor;
  const scores = Object.fromEntries(
    categories.map((c) => [c.categoryName, c.score]),
  );
  const score = (k) => (valid(scores[k]) ? scores[k] : null);
  const asym = (a, b) => (valid(a) && valid(b) ? Math.abs(a - b) : null);
  return {
    lipAperture: (distance(px(13), px(14)) / d) * factor,
    mouthWidth: (distance(px(61), px(291)) / d) * factor,
    lowerLipY: localY(14),
    jawY: localY(152),
    headRoll: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    jawOpen: score("jawOpen"),
    smileLeft: score("mouthSmileLeft"),
    smileRight: score("mouthSmileRight"),
    blinkLeft: score("eyeBlinkLeft"),
    blinkRight: score("eyeBlinkRight"),
    browRaise: score("browInnerUp"),
    smileAsymmetry: asym(score("mouthSmileLeft"), score("mouthSmileRight")),
    blinkAsymmetry: asym(score("eyeBlinkLeft"), score("eyeBlinkRight")),
  };
}
export function poseMetrics(points, width, height) {
  const visible = (i) =>
    points[i] &&
    valid(points[i].x) &&
    valid(points[i].y) &&
    (points[i].visibility ?? 0) >= 0.6;
  const p = (i) => ({ x: points[i].x * width, y: points[i].y * height });
  let shoulderTilt = null,
    torsoLean = null;
  if ([11, 12].every(visible)) {
    const a = p(11),
      b = p(12);
    if (distance(a, b) > 1e-6)
      shoulderTilt =
        (Math.atan2(a.y - b.y, Math.abs(a.x - b.x)) * 180) / Math.PI;
    if ([23, 24].every(visible)) {
      const h = { x: (p(23).x + p(24).x) / 2, y: (p(23).y + p(24).y) / 2 };
      const s = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (distance(h, s) > 1e-6)
        torsoLean = (Math.atan2(s.x - h.x, h.y - s.y) * 180) / Math.PI;
    }
  }
  return { shoulderTilt, torsoLean };
}
export function correlation(a, b) {
  const pairs = a.map((v, i) => [v, b[i]]).filter((p) => p.every(valid));
  if (pairs.length < 3) return null;
  const ma = mean(pairs.map((p) => p[0])),
    mb = mean(pairs.map((p) => p[1]));
  let aa = 0,
    bb = 0,
    ab = 0;
  for (const [x, y] of pairs) {
    aa += (x - ma) ** 2;
    bb += (y - mb) ** 2;
    ab += (x - ma) * (y - mb);
  }
  return aa * bb > 1e-16
    ? Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb)))
    : null;
}
export function summarize(rows, step) {
  const values = (key) => rows.map((r) => r.metrics?.[key] ?? null);
  const speeds = [];
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i].time - rows[i - 1].time;
    const a = rows[i - 1].metrics?.lowerLipY,
      b = rows[i].metrics?.lowerLipY;
    if (dt > 0 && dt <= step * 1.6 && valid(a) && valid(b))
      speeds.push(Math.abs(b - a) / dt);
  }
  const apertures = values("lipAperture").filter(valid);
  return {
    samples: rows.length,
    lipApertureRange: apertures.length
      ? Math.max(...apertures) - Math.min(...apertures)
      : null,
    lowerLipMeanSpeed: mean(speeds),
    lipJawCorrelation: correlation(values("lowerLipY"), values("jawY")),
    bilateralSmileCorrelation: correlation(
      values("smileLeft"),
      values("smileRight"),
    ),
    meanSmileAsymmetry: mean(values("smileAsymmetry").filter(valid)),
    mouthAudioCorrelation: correlation(
      values("lipAperture"),
      rows.map((r) => r.audioRms ?? null),
    ),
  };
}
export function faceBox(points) {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}
/** Conservative local tracking: ambiguity creates a new segment rather than claiming re-identification. */
export class TrackManager {
  constructor() {
    this.tracks = [];
    this.nextId = 1;
  }
  update(boxes, time) {
    this.tracks = this.tracks.filter(
      (t) => time - t.time <= 0.8 && time >= t.time,
    );
    const candidates = boxes.map((box) =>
      this.tracks
        .map((t) => {
          const dt = time - t.time;
          const predicted = { x: t.box.x + t.vx * dt, y: t.box.y + t.vy * dt };
          const scale = Math.max(0.08, box.w, t.box.w);
          return {
            t,
            cost:
              distance(box, predicted) / scale +
              Math.abs(
                Math.log(Math.max(0.001, box.w) / Math.max(0.001, t.box.w)),
              ) *
                0.25,
          };
        })
        .filter((c) => c.cost < 1.2)
        .sort((a, b) => a.cost - b.cost),
    );
    const used = new Set();
    const results = new Array(boxes.length);
    const order = boxes
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (candidates[a][0]?.cost ?? Infinity) -
          (candidates[b][0]?.cost ?? Infinity),
      );
    for (const i of order) {
      const cs = candidates[i].filter((c) => !used.has(c.t.id));
      const ambiguous = cs.length > 1 && cs[1].cost - cs[0].cost < 0.2;
      // Retire both competing tracks so an ambiguous crossing cannot reconnect old identities.
      if (ambiguous) {
        const retired = new Set(cs.map((c) => c.t.id));
        for (const id of retired) used.add(id);
        this.tracks = this.tracks.filter((t) => !retired.has(t.id));
      }
      let track = ambiguous ? null : cs[0]?.t;
      const box = boxes[i];
      if (track) {
        const dt = time - track.time;
        track.vx = dt > 0 ? (box.x - track.box.x) / dt : 0;
        track.vy = dt > 0 ? (box.y - track.box.y) / dt : 0;
        track.box = box;
        track.time = time;
      } else {
        track = { id: this.nextId++, box, time, vx: 0, vy: 0 };
        this.tracks.push(track);
      }
      used.add(track.id);
      results[i] = { id: track.id, ambiguous };
    }
    return results;
  }
}
/** Hann-windowed radix-2 FFT, magnitude dBFS. */
export function spectrum(samples) {
  const n = samples.length;
  if (n < 2 || n & (n - 1))
    throw new Error("FFT length must be a power of two");
  const re = Float64Array.from(
    samples,
    (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
  );
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1)
    for (let i = 0; i < n; i += len)
      for (let j = 0; j < len / 2; j++) {
        const angle = (-2 * Math.PI * j) / len,
          c = Math.cos(angle),
          s = Math.sin(angle),
          k = i + j,
          h = k + len / 2;
        const tr = re[h] * c - im[h] * s,
          ti = re[h] * s + im[h] * c;
        re[h] = re[k] - tr;
        im[h] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
      }
  return Array.from(
    { length: n / 2 },
    (_, i) =>
      20 * Math.log10(Math.max(1e-6, (Math.hypot(re[i], im[i]) * 4) / n)),
  );
}
export function toCSV(rows) {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return [
    keys.map(cell).join(","),
    ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ].join("\r\n");
}
