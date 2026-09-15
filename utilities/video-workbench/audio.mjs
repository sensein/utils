/** Display-only peak normalization. RMS stays on the original mono amplitude scale. */
export function waveformSummary(samples, requestedColumns = 900) {
  const columns = Math.min(samples.length, requestedColumns);
  const wave = [],
    rms = [];
  let peak = 0;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor((c * samples.length) / columns);
    const end = Math.floor(((c + 1) * samples.length) / columns);
    let lo = 0,
      hi = 0,
      sum = 0;
    for (let i = start; i < end; i++) {
      const value = samples[i];
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
      sum += value * value;
    }
    peak = Math.max(peak, -lo, hi);
    wave.push([lo, hi]);
    rms.push(Math.sqrt(sum / (end - start)));
  }
  return {
    wave: wave.map((pair) => pair.map((v) => (peak ? v / peak : 0))),
    rms,
    peak,
    columns,
  };
}
/** Zero pad beyond boundaries, without shifting a window's time origin. */
export function centeredWindow(samples, center, size) {
  const window = new Float32Array(size);
  const offset = Math.round(center) - Math.floor(size / 2);
  const start = Math.max(0, offset),
    end = Math.min(samples.length, offset + size);
  if (end > start) window.set(samples.subarray(start, end), start - offset);
  return window;
}
