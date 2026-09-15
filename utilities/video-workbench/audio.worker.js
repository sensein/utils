import { spectrum } from "./metrics.mjs";
self.onmessage = ({ data }) => {
  try {
    const samples = data.samples,
      rate = data.rate;
    const columns = 900,
      bins = 128,
      fft = 1024;
    const wave = [],
      rms = [],
      db = [];
    for (let c = 0; c < columns; c++) {
      const start = Math.floor((c * samples.length) / columns),
        end = Math.max(
          start + 1,
          Math.floor(((c + 1) * samples.length) / columns),
        );
      let lo = 0,
        hi = 0,
        sum = 0;
      for (let i = start; i < Math.min(end, samples.length); i++) {
        const v = samples[i];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        sum += v * v;
      }
      wave.push([lo, hi]);
      rms.push(Math.sqrt(sum / (end - start)));
      const window = new Float32Array(fft);
      const offset = Math.max(0, Math.round((start + end) / 2) - fft / 2);
      window.set(
        samples.subarray(offset, Math.min(samples.length, offset + fft)),
      );
      const spec = spectrum(window),
        maxHz = Math.min(8000, rate / 2);
      db.push(
        Array.from({ length: bins }, (_, b) => {
          const from = Math.floor((((b / bins) * maxHz) / rate) * fft),
            to = Math.max(
              from + 1,
              Math.floor(((((b + 1) / bins) * maxHz) / rate) * fft),
            );
          return Math.max(...spec.slice(from, to));
        }),
      );
    }
    self.postMessage({
      wave,
      rms,
      db,
      duration: samples.length / rate,
      rate,
      maxHz: Math.min(8000, rate / 2),
      fftSize: fft,
      columns,
      note: "Display STFT uses 900 uniformly spaced Hann windows; waveform and RMS aggregate all samples.",
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
