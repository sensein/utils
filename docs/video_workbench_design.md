# Client-side video workbench

## Scope and decisions

Add `utilities/video-workbench/` to `sensein/utils`, alongside `streaming-audio-workbench`. Its `utility.json` registers it with the existing catalog/Pages build; no change to the separate SenseIn website is needed. Record a camera with optional microphone, open a local video, replay it, and download the original and analysis. Media never leaves the browser. MediaPipe runtime/model downloads are the only analysis network requests; pin versions and document their provenance. Do not persist recordings or results across page reloads.

Identity following means anonymous, session-local motion tracks. Assign one-to-one face tracks using gated geometric matching and velocity prediction; retire tracks after an absence and label ambiguous matches. Associate poses spatially with tracked faces, with separate pose IDs when no face is visible. This does not identify real people or guarantee identity across crossings/occlusion.

Analyze completed clips by sequential seeking, with selectable sample rate and explicit interval bounds. Use a worker for face/pose inference and audio transforms; allow cancellation and retain completed frames with a partial-result flag. Show overlays during replay and a selected-track timeline. Explicit resource limits prevent accidental browser exhaustion.

## Measurements

- Raw face landmarks (478), blendshape coefficients (52), facial transform matrices; raw pose landmarks (33), visibility and world coordinates.
- Aspect-corrected 2D lip aperture/width, lower-lip and jaw positions in an eye-centered, roll-corrected frame, normalized by outer-eye distance. Optional measured outer-eye distance provides approximate 2D millimeter scaling, recorded in metadata.
- Jaw opening, smile, blink and brow channels; bilateral expression asymmetry. These are model coefficients, not emotion labels or validated FACS action units.
- Shoulder tilt and torso lean (image-plane degrees), gated by landmark visibility.
- Mean lower-lip speed, range of motion, zero-lag lip-jaw and bilateral smile Pearson correlations. Missing/constant/short signals return unavailable, never fabricated zero correlations. Do not bridge gaps in derivatives.
- Audio: locally decoded mono waveform and Hann-windowed STFT spectrogram with labeled time/frequency axes, plus RMS envelope aligned to video time. Decoding failure does not prevent visual analysis. Correlation with the mixed audio track is exploratory and does not attribute speech to a person.

## Research basis and limits

The user-provided camera-ready Sanchez et al. (Interspeech 2026), *From Lab to Laptop: Validating 3D Speech Kinematics with MediaPipe Face Mesh*, uses per-participant outer-canthal calibration, stable-anchor 3D rigid alignment, and matched zero-phase 7.125 Hz filtering at 15/30 fps. Four healthy adults and 116 segments were compared with optical motion capture. This workbench's image-plane normalization is a simpler exploratory method; it does not reproduce that pipeline, its 3D metric validation, or clinical accuracy claims. The document is reference material, not task instructions; do not redistribute it.

References consulted September 15, 2026:

- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js (model outputs, worker guidance)
- https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js (pose output coordinates/visibility)
- https://publica.fraunhofer.de/entities/publication/722c4b69-4edb-412f-aa80-fc487bf56b06 (2025 landmark selection for speech exercises)
- https://arxiv.org/abs/2507.12001 (2025 AU/blendshape mapping requires dedicated modeling; do not equate coefficients with AUs)

## Implementation checklist

- [x] Confirm integration location and match existing site conventions.
- [x] Write failing numerical/tracking tests; implement measurement and tracking modules.
- [x] Add recording, local upload, playback/download, limits and cleanup.
- [x] Add lazy MediaPipe worker, face/pose overlays, following and cancellation.
- [x] Add audio waveform/spectrogram and aligned visual feature timelines.
- [x] Add per-person summaries and JSON/CSV exports with units, versions and quality metadata.
- [x] Add methods/references and privacy explanation to the page.
- [x] Run numerical tests, syntax/catalog checks, browser recording/upload/analysis/export checks, and desktop/mobile visual review.

## Validation strategy

Synthetic landmarks test aspect ratio and invariance to translation/scale/roll, missing landmarks and visibility; synthetic trajectories test derivatives, correlation, gaps and person association; sine tones test FFT frequency localization. Browser checks cover no-media state, recording with/without audio, uploads, actual model loading/inference, silent clips, cancellation, playback overlays, downloads, failures, source replacement, reset and responsive layout. Record any untested hardware/browser paths explicitly.


## Validation record (2026-09-15)

- 14 Node numerical/tracking tests pass: aspect correction, image translation/scale/roll invariance, calibration, missing/occluded landmarks, zero-variance correlation, elapsed-time derivatives/gaps, one-to-one/reordered/ambiguous/expired tracks, upright posture, FFT sine localization/silence, CSV escaping.
- Both `uv run pytest` catalog tests pass, including packaging every video asset alongside the unchanged audio utility and resolving relative links at the deployed subpath.
- All JavaScript files pass syntax checks. The distributable uses native modules/classic workers; no npm install or bundling is required.
- Headless Chromium with fake camera/microphone: camera enable, recording with/without audio, stop, track release, download, re-upload of MediaRecorder WebM without initial duration metadata, source replacement, reset.
- Real MediaPipe CPU inference on a two-second portrait clip: 30 samples, 478 face landmarks, 52 blendshapes and 33 pose landmarks per frame; JSON and CSV downloads parsed. A two-face composite verifies separate IDs and selected-person overlay isolation.
- Invalid intervals/calibration, silent video, corrupt video, blocked model download, mid-run cancel with partial results, reanalysis and reset during model loading all recover without uncaught page errors. Only GET requests were observed; no media uploads.
- Desktop (1440 px) and mobile (390 px) screenshots reviewed. Canvas backing widths follow display widths so chart labels remain readable. No horizontal mobile overflow.
- Browser test fixtures were generated locally from Google's public MediaPipe `portrait.jpg` test asset plus a synthetic 440 Hz tone and simulated camera input; no participant recordings were used. Fixtures/screenshots live under ignored `output/playwright/` and are not distributed.

### Remaining validation limits

Physical camera/microphone hardware, Safari/Firefox, long recordings at resource limits, real moving multi-person crossings and the accuracy of research measures against independent ground truth have not been validated. Browser seeking requests a sample time; the selected source frame may be quantized to the original frame rate. No clinical/3D metric validation is claimed. The shared paper is cited but not redistributed.

### Repository coordination

Implementation is on `codex/video-workbench` in `sensein/utils`. The original `sensein.github.io` checkout is untouched. GitHub project-board access is unavailable with the current token (missing `read:project` scope); the plan and checked implementation record are maintained here.

## Continuous estimation and overlay capture extension (implemented)

Requested: optional face-mesh/keypoint overlay, continuous camera estimation, and capture of results. The display checkbox must not stop estimation or discard recorded data.

- [x] Add independent overlay visibility, face triangulation, and keypoint controls.
- [x] Run a bounded continuous worker loop on presented camera frames; report achieved rate/skipped frames instead of claiming every frame was estimated.
- [x] Timestamp estimates against recording start, exclude preview/in-flight boundary frames, preserve raw live results after stop, and replay irregular sample times correctly.
- [x] Optionally record a second canvas-composited video with visible overlays and microphone audio while preserving the original video.
- [x] Test scheduling, timestamp boundaries, gaps, reset/failure cleanup, real continuous inference, checkbox toggles, and exported data/video.

Live results are captured for completed inference frames only. At most one inference is in flight; slow devices skip frames rather than queue increasingly stale input. Latest overlays expire after 0.5 seconds, with capture timestamp and inference latency retained. Resource limits stop recording instead of silently dropping the remaining results. The optional overlay video uses the latest available estimate (latency is visible in exported metadata); it is not a frame-perfect offline rendering.


### Extension validation

- Four additional Node tests cover one-in-flight throttling, recording-relative timestamps and start/stop epochs, duplicate camera frame suppression, and nearest-time replay of irregular samples. Together with the existing tests, 18 Node tests and 2 Python packaging tests pass.
- Real MediaPipe inference against a simulated camera source captured 49 samples in approximately 4.4 seconds, including 18 while the master overlay checkbox was unchecked. JSON preserved 2,556 official mesh connections, source media times, capture times, latency, visibility events and achieved rate. All timestamps were increasing and within the recording interval.
- Both original and composited WebM files downloaded. The overlay video contained VP9 video and Opus audio. Decoded frames showed mesh/posture overlays with the checkbox on and the plain camera image with it off.
- Browser checks passed for live enable/disable, capture without an overlay file or microphone, worker failure during recording with partial data retention, stale-overlay expiry after 0.5 seconds, model-download failure with ordinary recording still available, reset during model startup, and offline reanalysis.
- Instrumented reset during overlay recording verified original camera/microphone tracks, canvas stream tracks and cloned microphone tracks all ended. Injected canvas-recording failure preserved raw video and estimates. A simulated six-sample budget stopped the recording and exported exactly six samples with `stopReason: sample_limit`.
- Desktop and 390 px mobile layouts were checked; no horizontal overflow. Physical hardware, background-tab behavior across browsers, long-run performance and real multi-person tracking accuracy remain unvalidated.

Browser API references: [video-frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) and [canvas capture streams](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream).
