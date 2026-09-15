/** Bound live inference, and separate camera time from recording-relative time. */
export class LiveClock {
  constructor(fps) {
    this.interval = 1000 / fps;
    this.busy = false;
    this.last = -Infinity;
    this.lastMediaTime = -Infinity;
    this.epoch = 0;
    this.recordStart = null;
    this.skipped = 0;
  }
  admit(now, mediaTime) {
    if (mediaTime === this.lastMediaTime) return false;
    this.lastMediaTime = mediaTime;
    if (this.busy || now - this.last < this.interval) {
      this.skipped++;
      return false;
    }
    this.last = now;
    this.busy = true;
    return true;
  }
  complete() {
    this.busy = false;
  }
  stamp(now) {
    return { now, epoch: this.epoch };
  }
  startRecording(now) {
    this.epoch++;
    this.recordStart = now;
    this.skipped = 0;
  }
  stopRecording() {
    this.epoch++;
    this.recordStart = null;
  }
  recordTime(stamp) {
    return this.recordStart !== null &&
      stamp.epoch === this.epoch &&
      stamp.now >= this.recordStart
      ? (stamp.now - this.recordStart) / 1000
      : null;
  }
}
export function nearestFrame(frames, time, maxDistance) {
  if (!frames.length) return null;
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [frames[lo - 1], frames[lo]].filter(Boolean);
  const nearest = candidates.reduce((best, f) =>
    Math.abs(f.time - time) < Math.abs(best.time - time) ? f : best,
  );
  return Math.abs(nearest.time - time) <= maxDistance ? nearest : null;
}
