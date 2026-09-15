# Blink, gaze and calibration workbench extension

## Scope and measurement contracts

Everything remains in the browser. Preserve raw landmarks, coefficients, timestamps, model versions, original recordings and the zero-phase policy: no temporal smoothing is introduced. Existing sample-rate and resource limits still apply.

### Torso trace

Diagnose missing pose association, disabled posture and missing hips separately. Keep the existing reliable shoulder-to-hip angle; add an explicitly selected mode for model-inferred hips (including out-of-frame coordinates), with per-sample confidence and a clear estimated-quality label. Never call an inferred hip observed. A close webcam view cannot measure true torso motion reliably. Display the quality and number of usable samples, not only a blank chart. Choose the sole available posture track when a posture signal has no data on the selected face; do not guess among multiple people.

### Blink encoding

Expose left/right blink coefficients as signals. Encode bilateral blink events using hysteresis (close at 0.6, reopen at 0.3), with onset, offset, duration, peak and complete/incomplete status. Missing detections, track changes or long sampling gaps end an event as incomplete rather than inventing a reopening. Long closures are retained but labelled eye closure, not blink. Event markers, a count and downloadable events accompany the raw coefficients. Low sample rates can miss brief blinks.

### Gaze

MediaPipe iris coordinates alone are not gaze. Extract eye-relative iris positions from the existing 478 landmarks, rejecting missing/closed eyes. Fit an experimental screen-gaze mapping from an explicit nine-target calibration, followed by four held-out validation targets. Use standardized ridge regression, no temporal filter. Store the model, target observations, viewport, track, calibration time and validation errors. Reject degenerate fits and poor held-out accuracy. Invalidate use when the camera session/track or viewport changes. No calibrated screen coordinates for unrelated uploaded clips. Eye-relative features remain available for those clips.

### Video calibration

Add a neutral-reference capture for the selected person's video geometry: collect a short stable camera interval, or use analyzed frames around the playback cursor. Report available channels and spread. Derive relative angles and normalized displacements without replacing absolute measures. Keep the existing measured outer-eye distance input for optional metric scale. Calibration is scoped to source/track and included in exports; changing sources resets it.

## Workflow

A compact Calibration panel beneath the video provides video-neutral capture, optional physical scale guidance, gaze calibration and status. A gaze calibration dialog displays targets across the viewport, records only new valid samples after a settling interval, and offers cancel/retry. During normal use an optional screen marker and horizontal/vertical gaze signals show valid calibrated estimates. Blink events appear beside the sampled measurements and as timeline markers. Calibration cannot run while recording, loading or offline analysis is active.

## Implementation checklist

- [x] Reproduce torso missingness with close-camera/cropped inputs and test quality/association handling.
- [x] Add tested blink event encoding and raw blink time courses.
- [x] Add tested iris features, regularized calibration and held-out validation.
- [x] Add video-neutral and gaze calibration UI with lifecycle invalidation.
- [x] Integrate signals, markers, calibration provenance and exports.
- [x] Verify actual inference, calibration failure/cancel/reset, synthetic successful calibration, source changes, responsive layout and resource cleanup.

## References

- [MediaPipe Iris](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/iris.md): iris tracking alone does not infer gaze location.
- [WebGazer research](https://cs.brown.edu/people/apapouts/papers/ijcai2016webgazer.pdf): motivates explicit calibration of browser camera features to screen coordinates. This implementation does not reuse WebGazer or claim its validation results.

Gaze accuracy must be reported from held-out points; scientific validation and physical-camera participant evaluation remain necessary before using this as a calibrated research instrument.

## Validation record — September 15, 2026

- 32 JavaScript tests and 2 Python/catalog tests pass; all workbench modules pass syntax checks, the complete site builds and the diff has no whitespace errors.
- Real MediaPipe inference on a portrait video and simulated camera exercised iris/blink signals, stable neutral references, relative signals, live recording and calibration retention after recording. Model initialization emitted its existing delegate/feedback messages; no uncaught page errors occurred.
- A browser-only worker fixture moved the pose nose outside the face box: selecting torso switched to the sole posture track and produced 30/30 valid samples. Another fixture made hips cropped/low visibility: the reliable channel stayed missing, the inferred-hips recovery action exposed the separate trace and exported confidence.
- Controlled bilateral closures with an intervening missing face produced two complete blinks and two incomplete closures. JSON and both CSV exports matched the timeline states and event boundaries. Test fixtures are not distributed as utility assets.
- Synthetic target-dependent eye features exercised all nine calibration and four held-out targets, marker display, continuous gaze capture, recording preservation and invalidation on an unrelated upload. Exports contain 72 training and 32 validation observations, their input-capture clocks, coefficients and held-out results. This verifies the mapping/workflow, not physical-camera accuracy.
- An independent browser session with an unchanged camera image rejected gaze calibration. Cancel/Escape, viewport change during calibration, clearing, estimation restart and camera shutdown released controls and reset calibration appropriately. Camera tracks were released.
- Desktop and 390-pixel mobile layouts were inspected; the page has no mobile horizontal overflow. The right column remains full height, with calibration/downloads under the video and methods in About.

Physical-camera participant accuracy, eyeglasses/lighting variation and Safari/Firefox performance remain unvalidated. The per-session held-out check is a usability gate, not a substitute for those evaluations.

Implementation tracked in [issue #6](https://github.com/sensein/utils/issues/6). GitHub Project creation is unavailable with the current token's project scopes; the issue and this checked design record hold the plan.
