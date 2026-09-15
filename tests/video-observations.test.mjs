import test from "node:test";
import assert from "node:assert/strict";
import {
  irisFeatures,
  encodeBlinks,
  fitGaze,
  predictGaze,
  validateGaze,
  neutralReference,
  relativeMetrics,
} from "../utilities/video-workbench/observations.mjs";
const near = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function eyes() {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [outer, inner, top, bottom, iris, x] of [
    [33, 133, 159, 145, 468, 0.3],
    [362, 263, 386, 374, 473, 0.6],
  ]) {
    p[outer] = { x, y: 0.4 };
    p[inner] = { x: x + 0.1, y: 0.4 };
    p[top] = { x: x + 0.05, y: 0.38 };
    p[bottom] = { x: x + 0.05, y: 0.42 };
    p[iris] = { x: x + 0.05, y: 0.4 };
  }
  return p;
}
test("iris features are eye-relative, missing and closed eyes are excluded", () => {
  const p = eyes(),
    f = irisFeatures(p, { blinkLeft: 0, blinkRight: 0 }, 640, 480);
  near(f.irisX, 0);
  near(f.irisY, 0);
  p[468].x += 0.02;
  p[473].x += 0.02;
  near(irisFeatures(p, {}, 640, 480).irisX, 0.2);
  assert.equal(irisFeatures(p, { blinkLeft: 0.8 }, 640, 480), null);
  assert.equal(irisFeatures([], {}, 640, 480), null);
});
test("blink hysteresis encodes closure through reopening without threshold chatter", () => {
  const rows = [0, 0.7, 0.45, 0.55, 0.2].map((v, i) => ({
    time: i * 0.1,
    metrics: { blinkLeft: v, blinkRight: v },
  }));
  const r = encodeBlinks(rows, 0.16);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].complete, true);
  near(r.events[0].onset, 0.1);
  near(r.events[0].offset, 0.4);
  assert.deepEqual(r.states, [0, 1, 1, 1, 0]);
});
test("missing detections and sample gaps do not fabricate a completed blink", () => {
  for (const rows of [
    [
      { time: 0, metrics: { blinkLeft: 0.8, blinkRight: 0.8 } },
      { time: 0.1, metrics: null },
      { time: 0.2, metrics: { blinkLeft: 0, blinkRight: 0 } },
    ],
    [
      { time: 0, metrics: { blinkLeft: 0.8, blinkRight: 0.8 } },
      { time: 1, metrics: { blinkLeft: 0, blinkRight: 0 } },
    ],
  ])
    assert.equal(encodeBlinks(rows, 0.2).events[0].complete, false);
  const r = encodeBlinks(
    [{ time: 0, metrics: { blinkLeft: 0.8, blinkRight: 0 } }],
    0.2,
  );
  assert.equal(r.events.length, 0);
});
const feature = (x, y) => [x * 0.3 - 0.15, y * 0.2 - 0.1, 0.5, 0.5, 0.3];
const targets = [0.1, 0.5, 0.9].flatMap((x) =>
  [0.1, 0.5, 0.9].map((y) => ({ x, y })),
);
const observations = targets.flatMap((t) =>
  Array.from({ length: 8 }, () => ({ target: t, features: feature(t.x, t.y) })),
);
test("calibrated gaze predicts unseen targets and rejects degenerate calibration", () => {
  const model = fitGaze(observations);
  assert.ok(model);
  const p = predictGaze(model, feature(0.3, 0.7));
  near(p.x, 0.3, 0.01);
  near(p.y, 0.7, 0.01);
  const validation = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.75 },
    { x: 0.75, y: 0.75 },
  ].map((t) => ({ target: t, features: feature(t.x, t.y) }));
  assert.equal(validateGaze(model, validation).accepted, true);
  assert.equal(
    fitGaze(observations.map((o) => ({ ...o, features: feature(0.5, 0.5) }))),
    null,
  );
  assert.equal(predictGaze(model, null), null);
  assert.equal(predictGaze(model, [0, 0, 0.9, 0.5, 0.3]), null);
  assert.equal(
    validateGaze(
      model,
      validation.map((o) => ({
        ...o,
        target: { x: 1 - o.target.x, y: 1 - o.target.y },
      })),
    ).accepted,
    false,
  );
});
test("neutral calibration preserves absolute values and omits unstable/unavailable channels", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    time: i * 0.1,
    metrics: {
      headRoll: 10 + ((i % 3) - 1) * 0.1,
      shoulderTilt: i * 10,
      torsoLean: null,
      lipAperture: 0.1,
    },
  }));
  const baseline = neutralReference(rows);
  assert.ok(baseline);
  near(baseline.values.headRoll, 10);
  assert.equal(baseline.values.shoulderTilt, undefined);
  assert.equal(baseline.values.torsoLean, undefined);
  const raw = { headRoll: 12, torsoLean: null };
  const relative = relativeMetrics(raw, baseline);
  near(relative.headRollRelative, 2);
  assert.equal(raw.headRoll, 12);
  assert.equal(neutralReference(rows.slice(0, 2)), null);
});

test("inferred torso trace survives cropped hips without claiming observed joints", async () => {
  const { poseMetrics } = await import(
    "../utilities/video-workbench/metrics.mjs"
  );
  const p = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  p[11] = { x: 0.3, y: 0.4, visibility: 1 };
  p[12] = { x: 0.7, y: 0.4, visibility: 1 };
  p[23] = { x: 0.35, y: 1.2, visibility: 0.1 };
  p[24] = { x: 0.75, y: 1.2, visibility: 0.1 };
  const m = poseMetrics(p, 640, 480);
  assert.equal(m.torsoLean, null);
  assert.ok(Number.isFinite(m.torsoLeanEstimated));
  assert.equal(m.torsoConfidence, 0.1);
  p[11].visibility = 0.1;
  assert.equal(poseMetrics(p, 640, 480).torsoLeanEstimated, null);
});
