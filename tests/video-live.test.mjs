import test from "node:test";
import assert from "node:assert/strict";
import { LiveClock, nearestFrame } from "../utilities/video-workbench/live.mjs";
test("live inference admits one frame at a time at the target rate", () => {
  const clock = new LiveClock(15);
  assert.ok(clock.admit(1000, 1));
  assert.equal(clock.admit(1100, 2), false);
  clock.complete();
  assert.equal(clock.admit(1020, 2), false);
  assert.ok(clock.admit(1100, 3));
  clock.complete();
  assert.equal(clock.admit(1200, 3), false);
});
test("recording timestamps exclude preview and frames captured before recording", () => {
  const clock = new LiveClock(15);
  const preview = clock.stamp(900);
  clock.startRecording(1000);
  assert.equal(clock.recordTime(preview), null);
  assert.equal(clock.recordTime(clock.stamp(999)), null);
  assert.equal(clock.recordTime(clock.stamp(1250)), 0.25);
});
test("stop excludes in-flight results and subsequent recording epochs", () => {
  const clock = new LiveClock(15);
  clock.startRecording(1000);
  const beforeStop = clock.stamp(1100);
  clock.stopRecording();
  assert.equal(clock.recordTime(beforeStop), null);
  clock.startRecording(2000);
  assert.equal(clock.recordTime(beforeStop), null);
});
test("playback selects by timestamp for irregular samples and preserves gaps", () => {
  const frames = [{ time: 0 }, { time: 0.12 }, { time: 0.24 }, { time: 0.75 }];
  assert.equal(nearestFrame(frames, 0.13, 0.1), frames[1]);
  assert.equal(nearestFrame(frames, 0.55, 0.1), null);
  assert.equal(nearestFrame([], 0, 0.1), null);
  assert.equal(nearestFrame(frames, -0.2, 0.1), null);
});
