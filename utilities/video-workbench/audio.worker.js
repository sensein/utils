import { waveformSummary, centeredWindow } from "./audio.mjs";
import { spectrum } from "./metrics.mjs";
self.onmessage = ({ data }) => {
  try {
    const samples = data.samples,
      rate = data.rate;
    const { wave, rms, peak, columns } = waveformSummary(samples);
    const bins = 128,
      fft = 1024,
      db = [];
    for (let c = 0; c < columns; c++) {
      const center = ((c + 0.5) * samples.length) / columns;
      const window = centeredWindow(samples, center, fft);
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
      waveformNormalization: {
        method: "full_clip_mono_peak",
        peak,
        displayOnly: true,
      },
      temporalFilter: "none",
      stftAlignment: "column_center; zero_padded_at_boundaries",
      note: "Display STFT uses up to 900 centered Hann windows; waveform is normalized to the full clip mono peak. RMS and dBFS retain original amplitudes. No temporal smoothing.",
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
