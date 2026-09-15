import {
  irisFeatures,
  fitGaze,
  predictGaze,
  validateGaze,
  neutralReference,
  relativeMetrics,
} from "./observations.mjs";
const targets = [0.12, 0.5, 0.88].flatMap((y) =>
  [0.12, 0.5, 0.88].map((x) => ({ x, y })),
);
const validationTargets = [
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 },
  { x: 0.7, y: 0.7 },
];
export class Calibration {
  constructor(el, context, changed) {
    this.el = el;
    this.context = context;
    this.changed = changed;
    this.neutral = {};
    this.gaze = null;
    this.pending = null;
    this.timer = null;
    el("neutral").onclick = () => this.captureNeutral();
    el("gaze-calibrate").onclick = () => this.startGaze();
    el("gaze-begin").onclick = () => {
      if (this.pending?.kind !== "gaze") return;
      this.pending.started = true;
      this.pending.stageStart = performance.now();
      this.showTarget();
    };
    el("gaze-cancel").onclick = () =>
      this.cancel("Gaze calibration cancelled.");
    el("gaze-dialog").addEventListener("cancel", () =>
      this.cancel("Gaze calibration cancelled."),
    );
    el("clear-calibration").onclick = () => {
      this.reset();
      this.message("Calibration cleared.");
      changed();
    };
    this.resize = () => {
      if (this.pending?.kind === "gaze")
        this.cancel("Viewport changed. Restart gaze calibration.");
      if (
        this.gaze &&
        !this.gaze.recorded &&
        (this.gaze.viewport.width !== innerWidth ||
          this.gaze.viewport.height !== innerHeight)
      ) {
        this.gaze.status = "invalidated";
        this.message("Viewport changed. Recalibrate gaze.");
      }
    };
    window.addEventListener("resize", this.resize);
  }
  get busy() {
    return !!this.pending;
  }
  message(text) {
    this.el("calibration-status").textContent = text;
  }
  updateControls() {
    const c = this.context(),
      ready = (c.mode === "camera" && c.liveReady) || c.mode === "clip";
    this.el("neutral").disabled = this.busy || !ready || !c.track;
    this.el("gaze-calibrate").disabled =
      this.busy ||
      c.mode !== "camera" ||
      !c.liveReady ||
      !c.track.startsWith("F");
    this.el("clear-calibration").disabled = [
      "recording",
      "finishing",
      "analyzing",
      "loading",
    ].includes(c.mode);
  }
  reset() {
    this.cancel();
    this.neutral = {};
    this.gaze = null;
    this.el("gaze-marker").hidden = true;
    this.message(
      "Set a neutral reference for video measures, or calibrate screen gaze with the live camera.",
    );
  }
  snapshot() {
    return structuredClone({ neutral: this.neutral, gaze: this.gaze });
  }
  restore(saved) {
    this.neutral = saved?.neutral ?? {};
    this.gaze = saved?.gaze ?? null;
    if (this.gaze) {
      this.gaze.source = this.context().source;
      this.gaze.recorded = true;
    }
    this.message(
      this.gaze?.status === "accepted"
        ? "Recorded gaze calibration retained. Coordinates refer to the original screen."
        : Object.keys(this.neutral).length
          ? "Video neutral reference retained."
          : "Set a neutral reference or calibrate screen gaze.",
    );
  }
  cancel(message) {
    const wasPending = !!this.pending;
    this.pending = null;
    clearInterval(this.timer);
    this.timer = null;
    if (this.el("gaze-dialog").open) this.el("gaze-dialog").close();
    if (message) this.message(message);
    this.updateControls();
    if (wasPending) this.changed();
  }
  captureNeutral() {
    const c = this.context();
    if (this.busy || !c.track || !["camera", "clip"].includes(c.mode)) return;
    if (c.mode === "clip") {
      const rows = c.frames
        .filter((f) => Math.abs(f.time - c.video.currentTime) <= 0.75)
        .map((f) => ({
          time: f.time,
          metrics: f.people.find((p) => p.id === c.track)?.metrics,
        }));
      this.finishNeutral(rows, c.track);
      return;
    }
    this.pending = {
      kind: "neutral",
      track: c.track,
      rows: [],
      start: performance.now(),
      source: c.source,
    };
    this.message(
      "Hold a relaxed neutral pose for 2 seconds. Keep the same person selected.",
    );
    this.changed();
    this.timer = setInterval(() => {
      if (
        this.pending?.kind === "neutral" &&
        performance.now() - this.pending.start > 2000
      ) {
        const p = this.pending;
        this.cancel();
        this.finishNeutral(p.rows, p.track);
      }
    }, 100);
  }
  finishNeutral(rows, track) {
    const reference = neutralReference(rows, this.context().eyeDistance ?? 1);
    if (!reference) {
      this.message(
        "Not enough stable observations. Analyze the clip first, or hold still and try again.",
      );
      this.changed();
      return;
    }
    this.neutral[track] = {
      ...reference,
      track,
      eyeDistance: this.context().eyeDistance ?? null,
      createdAt: new Date().toISOString(),
      source: this.context().source,
      timeBasis:
        this.context().mode === "camera"
          ? "camera_preview_seconds"
          : "clip_seconds",
    };
    this.message(
      `Neutral reference saved for ${track}: ${Object.keys(reference.values)
        .map(
          (key) =>
            ({
              headRoll: "head roll",
              shoulderTilt: "shoulder tilt",
              torsoLean: "torso lean",
              torsoLeanEstimated: "inferred torso lean",
              lipAperture: "lip aperture",
              mouthWidth: "mouth width",
              lowerLipY: "lower-lip position",
              jawY: "jaw position",
            })[key],
        )
        .join(", ")}. Relative signals are now available.`,
    );
    this.changed();
  }
  startGaze() {
    const c = this.context();
    if (
      this.busy ||
      c.mode !== "camera" ||
      !c.liveReady ||
      !c.track.startsWith("F")
    )
      return;
    this.gaze = null;
    this.pending = {
      kind: "gaze",
      track: c.track,
      source: c.source,
      viewport: { width: innerWidth, height: innerHeight },
      index: 0,
      training: [],
      validation: [],
      samples: [],
      stageStart: performance.now(),
      model: null,
      started: false,
    };
    this.el("gaze-dialog").showModal();
    this.el("gaze-marker").hidden = true;
    this.showTarget();
    this.changed();
    this.timer = setInterval(() => {
      const p = this.pending;
      if (p?.kind !== "gaze" || !p.started) return;
      if (performance.now() - p.stageStart > 12000)
        this.cancel(
          "Could not collect enough open-eye observations. Improve lighting, face the camera and retry.",
        );
    }, 100);
  }
  showTarget() {
    const p = this.pending;
    if (p?.kind !== "gaze") return;
    const target = [...targets, ...validationTargets][p.index];
    this.el("gaze-begin").hidden = p.started;
    this.el("gaze-target").hidden = !p.started;
    if (!p.started) {
      this.el("gaze-instruction").textContent =
        "Keep one person in view. Follow each dot with your eyes while keeping your head still.";
      this.el("gaze-sample-progress").textContent =
        "Nine calibration targets, then four accuracy checks. About 20 seconds.";
      const box = this.el("gaze-instruction").parentElement;
      box.style.top = "30%";
      box.style.bottom = "auto";
      return;
    }
    const instructions = this.el("gaze-instruction").parentElement;
    instructions.style.top = target.y < 0.5 ? "auto" : "4%";
    instructions.style.bottom = target.y < 0.5 ? "4%" : "auto";
    const dot = this.el("gaze-target");
    dot.style.left = `${target.x * 100}%`;
    dot.style.top = `${target.y * 100}%`;
    this.el("gaze-instruction").textContent =
      `${p.index < 9 ? "Calibration" : "Accuracy check"} ${p.index < 9 ? p.index + 1 : p.index - 8}/${p.index < 9 ? 9 : 4} · look at the dot and keep your head still.`;
    this.el("gaze-sample-progress").textContent =
      `${p.samples.length}/8 usable samples`;
  }
  observe(frame) {
    const p = this.pending;
    if (!p) return;
    const c = this.context();
    if (c.source !== p.source || c.mode !== "camera" || c.track !== p.track) {
      this.cancel("Calibration stopped: camera or selected person changed.");
      return;
    }
    const person = frame.people.find((person) => person.id === p.track);
    if (p.kind === "neutral") {
      if (frame.captureClockMs >= p.start)
        p.rows.push({ time: frame.time, metrics: person?.metrics });
      return;
    }
    if (
      !p.started ||
      frame.captureClockMs - p.stageStart < 650 ||
      !person?.eyeFeatures ||
      frame.people.filter((p) => p.face).length !== 1
    )
      return;
    const target = [...targets, ...validationTargets][p.index];
    p.samples.push({
      target,
      features: [...person.eyeFeatures],
      time: frame.time,
      captureClockMs: frame.captureClockMs,
    });
    this.showTarget();
    if (p.samples.length < 8) return;
    (p.index < 9 ? p.training : p.validation).push(...p.samples);
    p.samples = [];
    p.index++;
    p.stageStart = performance.now();
    if (p.index === 9) {
      p.model = fitGaze(p.training);
      if (!p.model) {
        this.cancel(
          "Calibration lacked enough eye movement. Follow each target with your eyes and retry.",
        );
        return;
      }
    }
    if (p.index === 13) {
      const quality = validateGaze(p.model, p.validation);
      quality.meanPixelError =
        quality.predictions.reduce(
          (sum, o) =>
            sum +
            (o.prediction
              ? Math.hypot(
                  (o.prediction.x - o.target.x) * p.viewport.width,
                  (o.prediction.y - o.target.y) * p.viewport.height,
                )
              : Math.hypot(p.viewport.width, p.viewport.height)),
          0,
        ) / quality.predictions.length;
      this.gaze = {
        track: p.track,
        source: p.source,
        viewport: p.viewport,
        model: p.model,
        training: p.training,
        validation: quality,
        validationObservations: p.validation,
        timeBasis:
          "camera_preview_seconds; captureClockMs is performance.now() at input capture",
        createdAt: new Date().toISOString(),
        status: quality.accepted ? "accepted" : "rejected",
        recorded: false,
      };
      this.cancel();
      this.message(
        `${quality.accepted ? "Gaze calibration accepted" : "Gaze calibration needs retry"} · mean validation error ${quality.meanPixelError.toFixed(0)} px (${(quality.meanError * 100).toFixed(1)}% normalized screen distance). ${quality.accepted ? "Keep camera, window size and seating position fixed." : "Improve lighting and follow each target without moving your head."}`,
      );
      this.changed();
      return;
    }
    this.showTarget();
  }
  enrich(person) {
    const c = this.context(),
      m = person.metrics ?? {};
    const eyes = person.face
      ? irisFeatures(person.face, m, c.video.videoWidth, c.video.videoHeight)
      : null;
    person.eyeFeatures = eyes?.vector ?? null;
    let prediction = null,
      reason = "uncalibrated";
    const g = this.gaze;
    if (
      g?.status === "accepted" &&
      g.source === c.source &&
      g.track === person.id
    ) {
      const sameViewport =
        g.recorded ||
        (g.viewport.width === innerWidth && g.viewport.height === innerHeight);
      prediction = sameViewport ? predictGaze(g.model, eyes?.vector) : null;
      reason = prediction
        ? "valid"
        : eyes
          ? "outside_calibration"
          : "eyes_closed_or_missing";
    }
    person.gaze = { ...(prediction ?? { x: null, y: null }), status: reason };
    person.metrics = {
      ...m,
      irisX: eyes?.irisX ?? null,
      irisY: eyes?.irisY ?? null,
      gazeX: prediction ? prediction.x * 100 : null,
      gazeY: prediction ? prediction.y * 100 : null,
    };
  }
  metrics(person) {
    const baseline = this.neutral[person.id];
    return {
      ...person.metrics,
      ...relativeMetrics(
        person.metrics,
        baseline?.eyeDistance === (this.context().eyeDistance ?? null)
          ? baseline
          : null,
      ),
    };
  }
  showGaze(person) {
    const c = this.context(),
      g = person?.gaze;
    const current =
      this.gaze?.status === "accepted" &&
      this.gaze.source === c.source &&
      this.gaze.track === person?.id;
    const visible =
      !this.busy &&
      current &&
      ["camera", "recording"].includes(c.mode) &&
      this.el("show-gaze").checked &&
      g?.status === "valid" &&
      g.inScreen;
    const marker = this.el("gaze-marker");
    marker.hidden = !visible;
    if (visible) {
      marker.style.left = `${g.x * 100}%`;
      marker.style.top = `${g.y * 100}%`;
    }
    this.el("gaze-readout").textContent =
      g?.status === "valid"
        ? `Screen gaze: ${(g.x * 100).toFixed(1)}%, ${(g.y * 100).toFixed(1)}%`
        : "Screen gaze unavailable · calibrate with the live camera; keep eyes visible.";
  }
  dispose() {
    this.cancel();
    window.removeEventListener("resize", this.resize);
  }
}
