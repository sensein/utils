# Video Workbench

A browser-only companion to the [Streaming Audio Workbench](../streaming-audio-workbench/README.md). Record video with optional microphone audio, open an existing local clip, and explore movement, expression, posture and acoustic signals on a shared timeline.

## Run

From the repository root:

```sh
uv run python scripts/build_pages_index.py --output site
uv run python -m http.server 8765 --directory site
```

Open http://localhost:8765/utilities/video-workbench/index.html. The existing catalog generator and Pages workflow copy the complete utility folder automatically. No JavaScript build step or server processing is required. Serve over HTTPS or localhost; opening `index.html` directly with `file://` does not support the module/worker workflow reliably.

## Workflow

1. **Collect:** enable the camera, optionally include microphone audio, record, and stop. Or choose a local MP4, WebM or MOV supported by your browser. Download the original recording at any time after capture.
2. **Analyze:** select an interval, 5/15/30 samples per second, and up to four people. Face analysis always runs; posture is optional. Analysis runs on completed recordings, not the live preview. Cancel retains completed frames.
3. **Explore:** select a face or posture track. Playback shows landmarks and expression coefficients; charts show the selected movement signal, waveform and spectrogram. Click charts or use the video's native controls to seek. “Isolate selected person” hides other people's overlays.
4. **Export:** JSON contains the full sampled timeline, raw landmarks, blendshapes, transform matrices, pose world coordinates, summaries, model URLs, processing settings, browser provenance and partial-result flags. CSV contains one row per person per sample, with explicit `no_detection` rows when no person is detected. Download before clearing or closing the tab.

## Privacy and resources

- Videos, audio, landmarks and measurements are processed in browser memory. No uploads, analytics, local storage or backend calls are used.
- Model inference is lazy: starting analysis downloads the pinned MediaPipe 0.10.32 runtime/WASM from jsDelivr and revision-1 face/pose model files from Google Storage. Network access is required on first use; cache availability is browser-controlled. These hosts receive normal asset-request information, not the recording.
- Closing/clearing stops camera/microphone tracks, terminates workers, closes audio contexts and releases media object URLs. A failed/unsupported audio decode leaves video analysis usable.
- Files are limited to 250 MiB and five minutes. Recording targets 4 Mbps and stops at five minutes or near 250 MiB (chunk boundaries can slightly exceed limits). At most 4,500 requested samples across selected people are allowed per run: a four-person setting permits at most 1,125 sampled frames.
- CPU inference runs in a dedicated worker; STFT computation runs in another worker. Sequential seeking can be slow for long-GOP videos. Short, well-lit clips are best.
- Camera/microphone permission, codecs and worker support depend on the browser. Chromium was verified with simulated devices; physical cameras and Safari/Firefox need a hardware/browser check before study use.

## Measurements and limitations

See [the design and validation record](../../docs/video_workbench_design.md) and the page's Methods section for formulas and references.

- Facial geometry is **2D**, aspect-corrected, and normalized by outer-eye distance (33–263). Local lower-lip (14) and jaw (152) coordinates remove image translation, scale and in-plane roll, not out-of-plane head rotation.
- Optional **measured outer-eye distance** (not interpupillary distance) provides approximate 2D millimeters for single-person clips. It is not the supplied Sanchez et al. paper's calibrated, head-stabilized 3D pipeline. Raw face z remains model-relative.
- Expression channels are model blendshape coefficients, not emotion labels, FACS action units or clinical outcomes. Shoulder tilt/torso lean require visibility ≥ 0.6 and use image-plane degrees. Positive torso lean means movement toward image right; head roll follows the 33→263 eye line in image coordinates.
- Range is max minus min. Mean speed uses absolute first differences in seconds, skipping gaps longer than 1.6 sampling intervals. No temporal filtering is applied; noise influences derivatives.
- Coordination is zero-lag Pearson correlation over at least three valid pairs, unavailable for constant/short signals. Lip–jaw coordination uses local vertical positions. Bilateral smile coordination uses left/right coefficients. Mouth–audio association uses lip aperture and the mixed-track RMS envelope; it does not identify the speaker or establish causality.
- Face tracks (`F…`) and unmatched posture tracks (`P…`) use local geometric matching with velocity prediction. Ambiguity starts a new segment; missing tracks expire after 0.8 seconds. Tracking is not biometric identification, and crossings, occlusion or rapid motion can change IDs. A pose is associated with a face only when its visible nose lies within one unique face box.
- Audio is decoded/resampled to 16 kHz and averaged to mono. The waveform and RMS use all samples; the display spectrogram uses 900 uniformly spaced 1,024-sample Hann windows and 128 linear-frequency display bins (up to 8 kHz). It is a display summary, not an exhaustive STFT export.

## Files and checks

All distributable code lives in this folder. `workbench.js` manages capture/playback and exports, `inference.worker.js` runs MediaPipe, `audio.worker.js` computes acoustic displays, `metrics.mjs` contains testable numerical/tracking routines, and `models.js` pins remote asset URLs. A classic inference worker is intentional: MediaPipe's WASM loader uses `importScripts`; dynamic module imports inside that worker load the runtime. The audio worker is a native module.

```sh
uv run pytest
node --test tests/video-metrics.test.mjs
node --check utilities/video-workbench/workbench.js
node --check utilities/video-workbench/inference.worker.js
node --check utilities/video-workbench/audio.worker.js
```

Before shipping changes, rerun numerical and catalog tests and repeat browser checks for camera with/without audio, upload, actual model loading, silent clips, cancellation, reset, exports and desktop/mobile layout. Update the displayed version and `BUILD_VERSION` together when behavior changes. No edits to the audio workbench's upstream source are required for this separate utility.
