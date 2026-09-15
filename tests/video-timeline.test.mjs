import test from "node:test";
import assert from "node:assert/strict";
import {
  timeWindow,
  timeAt,
  followWindow,
} from "../utilities/video-workbench/timeline.mjs";

test("window clamps to source boundaries and full view handles short or empty clips", () => {
  assert.deepEqual(timeWindow(30, 5, 29), { start: 25, end: 30, span: 5 });
  assert.deepEqual(timeWindow(2, 5, 10), { start: 0, end: 2, span: 2 });
  assert.deepEqual(timeWindow(30, 0, 20), { start: 0, end: 30, span: 30 });
  assert.deepEqual(timeWindow(0, 5, 10), { start: 0, end: 0, span: 0 });
});
test("chart seeking maps visible window rather than full duration", () => {
  const view = timeWindow(30, 5, 10);
  assert.equal(timeAt(view, 0.5), 12.5);
  assert.equal(timeAt(view, -1), 10);
  assert.equal(timeAt(view, 2), 15);
});
test("playback follows only outside the visible window and clamps at clip end", () => {
  const view = timeWindow(30, 5, 10);
  assert.deepEqual(followWindow(view, 12, 30), view);
  assert.deepEqual(followWindow(view, 20, 30), { start: 19, end: 24, span: 5 });
  assert.deepEqual(followWindow(view, 30, 30), { start: 25, end: 30, span: 5 });
  assert.deepEqual(followWindow(view, 0, 30), { start: 0, end: 5, span: 5 });
});
