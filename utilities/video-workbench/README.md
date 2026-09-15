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

1. **Collect continuously:** open **Recording & analysis settings**, select the sample rate, people and posture settings, then enable the camera. Continuous MediaPipe estimation and a rolling 10-second movement plot are enabled by default; models load before recording can start. Preview shows a face mesh, face keypoints and posture keypoints. Record and stop to retain timestamped estimates alongside the original video. Or choose a local MP4, WebM or MOV.
2. **Choose overlays:** the **Show MediaPipe overlay** checkbox controls visibility independently of estimation and data capture. Mesh, face keypoints and posture keypoints have their own layer checkboxes. **Also save a video with overlays** records a second downloadable video with the visible layers and microphone audio; the original video is retained separately. Turning off display never stops landmark capture.
3. **Analyze existing clips:** select an interval, 5/15/30 samples per second, and up to four people. Face analysis always runs; posture is optional. Cancel retains completed frames. Reanalysis replaces the active results, so export live data first if you want to preserve that run.
4. **Explore:** select a face or posture track. The analysis column extends through all its sections: aligned signals, person summaries and sampled measurements. Scroll the page to review them beside the video and downloads; only the sample table has its own bounded scroll area. Use **Time window** to zoom, **Visible interval** to pan, or horizontal/Shift-scroll over any chart. All three signals share the same interval. Hover over any signal for a linked dashed gold inspection line and time; the solid white line marks playback. Hovering does not seek. Click a chart or sample timestamp to seek; the **Playback** slider also supports keyboard seeking. **Follow playback** advances the charts and scrolls to the current sample; manual panning turns it off. Summaries use the full analyzed interval, regardless of zoom. “Isolate selected person” is under **Overlay options**.
5. **Export:** use **Take your work with you** directly beneath the video. JSON contains the full sampled timeline, raw landmarks, blendshapes, transform matrices, pose world coordinates, summaries, model URLs, processing settings, browser provenance and partial-result flags. CSV contains one row per person per sample, with explicit `no_detection` rows when no person is detected. Download before clearing or closing the tab.

## Privacy and resources

- Videos, audio, landmarks and measurements are processed in browser memory. No uploads, analytics, local storage or backend calls are used.
- Model inference is lazy: enabling the camera with continuous estimation selected, or starting clip analysis, downloads the pinned MediaPipe 0.10.32 runtime/WASM from jsDelivr and revision-1 face/pose model files from Google Storage. Network access is required on first use; cache availability is browser-controlled. These hosts receive normal asset-request information, not the recording.
- Closing/clearing stops camera/microphone tracks, terminates workers, closes audio contexts and releases media object URLs. A failed/unsupported audio decode leaves video analysis usable.
- Files are limited to 250 MiB and five minutes. Each video encoder targets 4 Mbps. Recording stops at five minutes, near 250 MiB combined across original/overlay videos (chunk boundaries can slightly exceed limits), or when live estimates reach the sample budget. At most 4,500 requested samples across selected people are allowed per run: a four-person setting permits at most 1,125 sampled frames.
- CPU inference runs in a dedicated worker; STFT computation runs in another worker. Sequential seeking can be slow for long-GOP videos. Short, well-lit clips are best.
- Camera/microphone permission, codecs and worker support depend on the browser. Chromium was verified with simulated devices; physical cameras and Safari/Firefox need a hardware/browser check before study use.

## Continuous capture details

- Live inference processes at most one presented camera frame at a time. Excess frames are skipped, not queued. The UI reports achieved rate and latency; JSON reports skipped camera callbacks and achieved samples/second. A requested 15 Hz does not guarantee 15 estimates/second.
- Estimates are timestamped at input capture using `performance.now()`, relative to recording start; camera media time and inference latency are also exported. Preview samples and in-flight samples crossing start/stop boundaries are excluded. Playback finds the nearest actual timestamp rather than assuming evenly spaced frames.
- Hiding the overlay does not pause processing. JSON retains visibility-change events and the official face-mesh connections. The overlay video shows the latest available result on the current video frame; estimates older than 0.5 seconds disappear. This is a latency-bearing live display, not frame-perfect offline annotation. The overlay encoder's start offset is exported.
- Keep the tab visible during capture: browsers can throttle background rendering and frame callbacks. Gaps remain visible in exported timestamps. No every-source-frame or hardware-level synchronization guarantee is made.
- If live inference fails, raw recording continues and completed estimates remain marked partial with the error. Failure to create the overlay video leaves raw video/data available. Clear session, camera-off and page exit stop inference and release media; clearing intentionally discards unsaved data.

## Measurements and limitations

See [the design and validation record](../../docs/video_workbench_design.md) and the **About ?** button beside the page title for formulas and references.

- Facial geometry is **2D**, aspect-corrected, and normalized by outer-eye distance (33–263). Local lower-lip (14) and jaw (152) coordinates remove image translation, scale and in-plane roll, not out-of-plane head rotation.
- Optional **measured outer-eye distance** (not interpupillary distance) provides approximate 2D millimeters for single-person clips. It is not the supplied Sanchez et al. paper's calibrated, head-stabilized 3D pipeline. Raw face z remains model-relative.
- Expression channels are model blendshape coefficients, not emotion labels, FACS action units or clinical outcomes. Shoulder tilt/torso lean require visibility ≥ 0.6 and use image-plane degrees. Torso lean requires both shoulders and both hips inside the image with visibility ≥0.6; unavailable values remain missing and the chart explains how to improve framing. Constant and isolated valid observations are drawn visibly. Positive torso lean means movement toward image right; head roll follows the 33→263 eye line in image coordinates.
- Range is max minus min. Mean speed uses absolute first differences in seconds, skipping gaps longer than 1.6 sampling intervals. No application temporal filtering is applied; noise influences derivatives. Face and pose inference use independent IMAGE frames to avoid MediaPipe's stream-mode temporal smoothing, while the workbench continues scheduling frames and tracking identities. This can be slower/noisier than video-mode inference. Any future temporal filtering must use offline forward/backward `filtfilt` (or second-order-section equivalent), with gaps and original timestamps preserved; one-pass causal smoothing is not allowed.
- Coordination is zero-lag Pearson correlation over at least three valid pairs, unavailable for constant/short signals. Lip–jaw coordination uses local vertical positions. Bilateral smile coordination uses left/right coefficients. Mouth–audio association uses lip aperture and the mixed-track RMS envelope; it does not identify the speaker or establish causality.
- Face tracks (`F…`) and unmatched posture tracks (`P…`) use local geometric matching with velocity prediction. Ambiguity starts a new segment; missing tracks expire after 0.8 seconds. Tracking is not biometric identification, and crossings, occlusion or rapid motion can change IDs. A pose is associated with a face only when its visible nose lies within one unique face box.
- Audio is decoded/resampled to 16 kHz and averaged to mono. The waveform is divided by the full clip's mono peak for display only (silence remains zero); RMS and spectrogram dBFS retain original amplitudes. The peak and normalization method are exported. The waveform and RMS use all samples; the display spectrogram uses up to 900 uniformly spaced, centered, 1,024-sample Hann windows with zero padding at boundaries and 128 linear-frequency display bins (up to 8 kHz). It is a display summary, not an exhaustive STFT export. Browser codec decoding/resampling is outside the application's temporal-filter control; no filtfilt equivalence is claimed for that stage.

## Files and checks

Shared timeline bounds and seeking are tested in `timeline.mjs`; live timing and nearest-sample playback are tested in `live.mjs`; `overlay-recording.js` owns the optional canvas recorder and cloned audio tracks. All distributable code lives in this folder. `workbench.js` manages capture/playback and exports, `inference.worker.js` runs MediaPipe, `audio.worker.js` computes acoustic displays, `metrics.mjs` contains testable numerical/tracking routines, and `models.js` pins remote asset URLs. A classic inference worker is intentional: MediaPipe's WASM loader uses `importScripts`; dynamic module imports inside that worker load the runtime. The audio worker is a native module.

```sh
uv run pytest
node --test tests/video-*.test.mjs
node --check utilities/video-workbench/workbench.js
node --check utilities/video-workbench/inference.worker.js
node --check utilities/video-workbench/audio.worker.js
```

Before shipping changes, rerun numerical and catalog tests and repeat browser checks for camera with/without audio, upload, actual model loading, silent clips, cancellation, reset, exports and desktop/mobile layout. Update the displayed version and `BUILD_VERSION` together when behavior changes. No edits to the audio workbench's upstream source are required for this separate utility.
