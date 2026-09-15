import test from "node:test";
import assert from "node:assert/strict";
import {
  waveformSummary,
  centeredWindow,
} from "../utilities/video-workbench/audio.mjs";
import { poseMetrics } from "../utilities/video-workbench/metrics.mjs";
import { signalRange } from "../utilities/video-workbench/timeline.mjs";

test("waveform uses one clip-wide peak while RMS retains original amplitude", () => {
  const samples = Float32Array.from([-0.2, 0.1, -0.4, 0.3]);
  const result = waveformSummary(samples, 2);
  assert.ok(Math.abs(result.peak - 0.4) < 1e-7);
  assert.ok(Math.abs(result.wave[0][0] + 0.5) < 1e-7);
  assert.ok(Math.abs(result.wave[1][0] + 1) < 1e-7);
  assert.ok(Math.abs(result.rms[0] - Math.sqrt(0.025)) < 1e-7);
  assert.deepEqual(
    [...samples],
    [...Float32Array.from([-0.2, 0.1, -0.4, 0.3])],
  );
});
test("silent, empty and very short audio remains finite", () => {
  for (const samples of [
    new Float32Array(4),
    new Float32Array(),
    Float32Array.of(0.5),
  ]) {
    const result = waveformSummary(samples, 900);
    assert.ok(result.wave.flat().every(Number.isFinite));
    assert.ok(result.rms.every(Number.isFinite));
    assert.ok(result.wave.length <= samples.length);
  }
  assert.equal(waveformSummary(new Float32Array(4), 4).peak, 0);
});
test("STFT padding preserves the requested center even at the recording edges", () => {
  const x = Float32Array.from([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...centeredWindow(x, 0, 4)], [0, 0, 1, 2]);
  assert.deepEqual([...centeredWindow(x, 5, 4)], [4, 5, 6, 0]);
  assert.deepEqual([...centeredWindow(x, 3, 4)], [2, 3, 4, 5]);
});
test("constant and isolated signals receive a centered visible range", () => {
  assert.deepEqual(signalRange([0, 0]), { lo: -0.5, hi: 0.5 });
  assert.deepEqual(signalRange([3]), { lo: 2.5, hi: 3.5 });
  assert.deepEqual(signalRange([null, NaN]), null);
  assert.deepEqual(signalRange([-2, 4]), { lo: -2, hi: 4 });
});
test("torso lean uses pixel aspect ratio and requires both shoulders and hips", () => {
  const p = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  p[11] = { x: 0.4, y: 0.2, visibility: 1 };
  p[12] = { x: 0.6, y: 0.2, visibility: 1 };
  p[23] = { x: 0.3, y: 0.6, visibility: 1 };
  p[24] = { x: 0.5, y: 0.6, visibility: 1 };
  assert.ok(Math.abs(poseMetrics(p, 200, 100).torsoLean - 26.565051177) < 1e-6);
  p[23].visibility = 0.59;
  assert.equal(poseMetrics(p, 200, 100).torsoLean, null);
  p[23].visibility = 1;
  p[23].y = 1.2;
  assert.equal(poseMetrics(p, 200, 100).torsoLean, null);
});
