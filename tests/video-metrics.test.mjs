import test from "node:test";
import assert from "node:assert/strict";
import {
  faceMetrics,
  poseMetrics,
  correlation,
  summarize,
  TrackManager,
  spectrum,
  toCSV,
} from "../utilities/video-workbench/metrics.mjs";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function face() {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  p[33] = { x: 0.3, y: 0.3, z: 0 };
  p[263] = { x: 0.7, y: 0.3, z: 0 };
  p[13] = { x: 0.5, y: 0.5, z: 0 };
  p[14] = { x: 0.5, y: 0.6, z: 0 };
  p[61] = { x: 0.4, y: 0.55, z: 0 };
  p[291] = { x: 0.6, y: 0.55, z: 0 };
  p[152] = { x: 0.5, y: 0.8, z: 0 };
  return p;
}
test("face geometry uses actual image aspect ratio and optional scale", () => {
  close(faceMetrics(face(), [], 200, 100).lipAperture, 0.125);
  close(faceMetrics(face(), [], 200, 100, 80).lipAperture, 10);
});
test("face local coordinates resist translation, scale and in-plane rotation", () => {
  const original = faceMetrics(face(), [], 200, 100);
  const angle = 0.3;
  const transformed = face().map((p) => ({
    x:
      ((Math.cos(angle) * p.x * 200 - Math.sin(angle) * p.y * 100) * 1.4) /
        200 +
      0.1,
    y:
      ((Math.sin(angle) * p.x * 200 + Math.cos(angle) * p.y * 100) * 1.4) /
        100 -
      0.2,
    z: 0,
  }));
  const next = faceMetrics(transformed, [], 200, 100);
  for (const key of ["lipAperture", "mouthWidth", "lowerLipY", "jawY"])
    close(original[key], next[key]);
});
test("invalid geometry and occluded posture return missing values", () => {
  assert.equal(faceMetrics([], [], 200, 100), null);
  assert.equal(
    faceMetrics(Array(478).fill({ x: 0.5, y: 0.5 }), [], 200, 100),
    null,
  );
  assert.equal(
    poseMetrics(Array(33).fill({ x: 0.5, y: 0.5, visibility: 0.1 }), 200, 100)
      .shoulderTilt,
    null,
  );
});
test("correlation rejects missing, constant and insufficient pairs", () => {
  assert.equal(correlation([1, 1, 1], [1, 2, 3]), null);
  assert.equal(correlation([1, null], [1, 3]), null);
  close(correlation([1, 2, null, 3], [3, 2, 4, 1]), -1);
});
test("velocity uses seconds and does not bridge tracking gaps", () => {
  const rows = [0, 0.1, 0.2, 1].map((t, i) => ({
    time: t,
    metrics: {
      lowerLipY: i,
      jawY: i * 2,
      lipAperture: i,
      mouthWidth: i,
      smileLeft: i,
      smileRight: i,
    },
  }));
  const result = summarize(rows, 0.1);
  close(result.lowerLipMeanSpeed, 10);
  close(result.lipJawCorrelation, 1);
  assert.equal(summarize([], 0.1).lipJawCorrelation, null);
});
test("track identity survives detection reorder and predicts motion", () => {
  const t = new TrackManager();
  const box = (x) => ({ x, y: 0.5, w: 0.15, h: 0.2 });
  const a = t.update([box(0.2), box(0.8)], 0);
  const b = t.update([box(0.75), box(0.25)], 0.1);
  assert.equal(a[0].id, b[1].id);
  assert.equal(a[1].id, b[0].id);
  assert.notEqual(t.update([box(0.25)], 3)[0].id, a[0].id);
});
test("ambiguous overlaps start new segments instead of silently swapping IDs", () => {
  const t = new TrackManager();
  t.update(
    [
      { x: 0.45, y: 0.5, w: 0.2, h: 0.2 },
      { x: 0.55, y: 0.5, w: 0.2, h: 0.2 },
    ],
    0,
  );
  const matches = t.update([{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }], 0.1);
  assert.equal(matches[0].ambiguous, true);
  assert.equal(matches[0].id, 3);
});
test("FFT locates a known sine frequency", () => {
  const samples = Float32Array.from({ length: 1024 }, (_, i) =>
    Math.sin((2 * Math.PI * 64 * i) / 1024),
  );
  const s = spectrum(samples);
  assert.equal(s.indexOf(Math.max(...s)), 64);
});
test("CSV escapes names, quotes and formula prefixes", () => {
  assert.equal(
    toCSV([{ label: "=SUM(A1)", value: 'a,"b"' }]),
    'label,value\r\n\'=SUM(A1),"a,""b"""',
  );
});
test("retired ambiguous IDs cannot reconnect on the next frame", () => {
  const t = new TrackManager();
  const box = (x) => ({ x, y: 0.5, w: 0.2, h: 0.2 });
  t.update([box(0.45), box(0.55)], 0);
  const ambiguous = t.update([box(0.5)], 0.1)[0];
  const next = t.update([box(0.5)], 0.2)[0];
  assert.equal(next.id, ambiguous.id);
  assert.equal(next.ambiguous, false);
});
test("one-to-one assignment never gives two detections the same ID", () => {
  const t = new TrackManager();
  const box = (x) => ({ x, y: 0.5, w: 0.1, h: 0.1 });
  t.update([box(0.3)], 0);
  const next = t.update([box(0.3), box(0.31)], 0.1);
  assert.equal(new Set(next.map((x) => x.id)).size, 2);
});
test("pose geometry measures level shoulders and upright torso", () => {
  const p = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  p[11] = { x: 0.7, y: 0.3, visibility: 1 };
  p[12] = { x: 0.3, y: 0.3, visibility: 1 };
  p[23] = { x: 0.6, y: 0.7, visibility: 1 };
  p[24] = { x: 0.4, y: 0.7, visibility: 1 };
  close(poseMetrics(p, 200, 100).shoulderTilt, 0);
  close(poseMetrics(p, 200, 100).torsoLean, 0);
});
test("missing expression coefficients are not presented as zeros", () => {
  const m = faceMetrics(face(), [], 200, 100);
  assert.equal(m.smileAsymmetry, null);
  assert.equal(m.jawOpen, null);
});
test("silence is finite at the FFT floor and invalid FFT sizes are rejected", () => {
  assert.ok(spectrum(new Float32Array(1024)).every((v) => v === -120));
  assert.throws(() => spectrum(new Float32Array(1000)));
});
