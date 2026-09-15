import { MODEL_INFO } from "./models.js";
import {
  faceMetrics,
  poseMetrics,
  faceBox,
  TrackManager,
  summarize,
  toCSV,
} from "./metrics.mjs";
export const BUILD_VERSION = "26.09.15";
const MAX_BYTES = 250 * 1024 * 1024,
  MAX_SECONDS = 300,
  MAX_FRAMES = 4500;
const colors = ["#58d5c6", "#ffcb77", "#a8a1ff", "#ff8dac"];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const format = (v, d = 3) => (finite(v) ? v.toFixed(d) : "—");
const errorText = (e) => (e instanceof Error ? e.message : String(e));
export function initVideoWorkbench() {
  if (!document.getElementById("video-workbench")) return;
  const el = (id) => document.getElementById(`vw-${id}`);
  const button = (id) => el(id),
    input = (id) => el(id),
    select = (id) => el(id);
  const video = el("video"),
    overlay = el("overlay");
  let mode = "empty";
  let media = null,
    mediaName = "",
    mediaURL = "",
    duration = 0,
    stream = null,
    recorder = null;
  let sourceGeneration = 0,
    recordStart = 0,
    recordTimer;
  let frames = [],
    audio = null,
    run = null,
    worker = null,
    audioWorker = null;
  let audioContext = null,
    requestId = 0,
    stopped = false;
  const pending = new Map();
  function status(message, error = false) {
    el("status").textContent = message;
    el("status").dataset.error = String(error);
  }
  function controls() {
    const busy = ["loading", "recording", "analyzing"].includes(mode);
    button("camera").disabled =
      busy || mode === "camera" || !navigator.mediaDevices?.getUserMedia;
    button("record").disabled =
      mode !== "camera" || typeof MediaRecorder === "undefined";
    button("stop").disabled = mode !== "recording";
    button("camera-off").disabled = mode !== "camera";
    input("file").disabled = busy;
    input("mic").disabled = busy || mode === "camera";
    select("resolution").disabled = busy || mode === "camera";
    button("download").disabled = !media || busy;
    button("analyze").disabled = mode !== "clip";
    button("cancel").disabled = mode !== "analyzing";
    el("settings").disabled = busy || mode === "camera";
    button("json").disabled = button("csv").disabled = !frames.length || busy;
    select("track").disabled = !frames.some((f) => f.people.length) || busy;
    el("empty").hidden = mode !== "empty";
    video.controls = mode === "clip";
  }
  function terminateWorker() {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Analysis cancelled"));
    }
    pending.clear();
  }
  function ask(data, transfer = [], timeout = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "Analysis timed out. Check model connectivity or try a shorter clip.",
          ),
        );
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...data, id }, transfer);
    });
  }
  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }
  function clearResults() {
    frames = [];
    run = null;
    select("track").replaceChildren(
      new Option("Analyze video to find people", ""),
    );
    el("metrics").textContent =
      "Movement and coordination summaries will appear here.";
    el("expressions").textContent =
      "Jaw, smile, blink, and brow model coefficients.";
    el("track-info").textContent =
      "Tracks follow motion within this clip. IDs may change at occlusions or crossings; they do not identify a person across recordings.";
    drawOverlay();
    drawMotion();
  }
  function release() {
    sourceGeneration++;
    stopped = true;
    terminateWorker();
    audioWorker?.terminate();
    audioWorker = null;
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    clearInterval(recordTimer);
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    stopCamera();
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (mediaURL) URL.revokeObjectURL(mediaURL);
    mediaURL = "";
    media = null;
    duration = 0;
    audio = null;
  }
  function reset() {
    release();
    mode = "empty";
    clearResults();
    drawAudio();
    input("file").value = "";
    input("start").value = "0";
    input("end").value = "";
    input("calibration").value = "";
    el("source").textContent = "No video loaded";
    el("audio-status").textContent =
      "An audio track, when decodable, appears here after opening or recording a video.";
    el("progress").hidden = true;
    status("Ready to collect a video.");
    controls();
  }
  function waitMedia(event, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        video.removeEventListener(event, ok);
        video.removeEventListener("error", bad);
      };
      const ok = () => {
        clean();
        resolve();
      };
      const bad = () => {
        clean();
        reject(
          new Error(
            "This video could not be decoded. Try a browser-supported MP4 or WebM file.",
          ),
        );
      };
      const timer = setTimeout(() => {
        clean();
        reject(
          new Error(
            "Video decoding timed out. Try a shorter MP4 or WebM clip.",
          ),
        );
      }, timeout);
      video.addEventListener(event, ok, { once: true });
      video.addEventListener("error", bad, { once: true });
    });
  }
  async function seek(time) {
    if (Math.abs(video.currentTime - time) < 0.00001 && video.readyState >= 2)
      return;
    const ready = waitMedia("seeked");
    video.currentTime = time;
    await ready;
  }
  async function loadClip(blob, name, knownDuration) {
    if (blob.size > MAX_BYTES && knownDuration === undefined) {
      status("This file exceeds 250 MB. Choose a smaller clip.", true);
      return;
    }
    release();
    clearResults();
    drawAudio();
    mode = "loading";
    controls();
    status("Opening video locally…");
    const generation = sourceGeneration;
    media = blob;
    mediaName = name;
    mediaURL = URL.createObjectURL(blob);
    try {
      const ready = waitMedia("loadedmetadata");
      video.src = mediaURL;
      video.muted = false;
      video.load();
      await ready;
      if (generation !== sourceGeneration) return;
      if (!video.videoWidth || !video.videoHeight)
        throw new Error("This file has no decodable video track.");
      duration = video.duration;
      if (!finite(duration)) {
        // MediaRecorder WebM files often omit duration metadata. Force the demuxer to find the end.
        const endReady = waitMedia("seeked");
        video.currentTime = 1e10;
        await endReady;
        duration = finite(video.duration)
          ? video.duration
          : (knownDuration ?? video.currentTime);
      }
      if (!finite(duration) || duration <= 0 || duration > MAX_SECONDS + 0.5)
        throw new Error(
          "Choose a video with a valid duration of five minutes or less.",
        );
      await seek(0);
      if (generation !== sourceGeneration) return;
      input("start").value = "0";
      input("end").value = duration.toFixed(3);
      input("start").max = input("end").max = String(duration);
      mode = "clip";
      el("source").textContent =
        `${name} · ${video.videoWidth}×${video.videoHeight} · ${duration.toFixed(1)} s`;
      status("Video ready. Choose an interval and analyze movement.");
      controls();
      drawMotion();
      void decodeAudio(blob, generation);
    } catch (e) {
      if (generation !== sourceGeneration) return;
      release();
      mode = "empty";
      el("source").textContent = "No video loaded";
      controls();
      status(errorText(e), true);
    }
  }
  async function decodeAudio(blob, generation) {
    el("audio-status").textContent = "Decoding the audio track locally…";
    let context = null;
    try {
      context = new AudioContext({ sampleRate: 16000 });
      audioContext = context;
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (generation !== sourceGeneration) return;
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++)
          mono[i] += channel[i] / buffer.numberOfChannels;
      }
      const rate = buffer.sampleRate;
      audioWorker = new Worker(new URL("./audio.worker.js", import.meta.url), {
        type: "module",
      });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Audio transform timed out")),
          30000,
        );
        audioWorker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data);
        };
        audioWorker.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Audio worker failed"));
        };
        audioWorker.postMessage({ samples: mono, rate }, [mono.buffer]);
      });
      if (generation !== sourceGeneration) return;
      audio = result;
      drawAudio();
      updateSummary();
      el("audio-status").textContent =
        `Mono audio · ${rate.toLocaleString()} Hz · ${result.fftSize}-sample Hann windows. Waveform and spectrogram share the video timeline. Silence appears flat. ${Math.abs(result.duration - duration) > 0.2 ? "Audio and video durations differ; review synchronization." : ""}`;
    } catch {
      if (generation === sourceGeneration) {
        audio = null;
        drawAudio();
        el("audio-status").textContent =
          "No decodable audio track in this browser. Video analysis remains available; try an MP4 with AAC or a WebM with Opus for audio.";
      }
    } finally {
      if (context && context.state !== "closed")
        await context.close().catch(() => {});
      if (audioContext === context) audioContext = null;
      if (generation === sourceGeneration) {
        audioWorker?.terminate();
        audioWorker = null;
      }
    }
  }
  button("camera").onclick = async () => {
    const generation = sourceGeneration;
    mode = "loading";
    controls();
    status("Waiting for camera permission…");
    try {
      const width = Number(select("resolution").value);
      const opened = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: (width * 9) / 16 },
          frameRate: { ideal: 30 },
        },
        audio: input("mic").checked
          ? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : false,
      });
      if (generation !== sourceGeneration) {
        opened.getTracks().forEach((t) => t.stop());
        return;
      }
      release();
      clearResults();
      stream = opened;
      video.srcObject = stream;
      video.muted = true;
      mode = "camera";
      await video.play();
      drawAudio();
      el("source").textContent = "Live camera preview";
      el("audio-status").textContent =
        "Audio signals will be available after recording.";
      status("Camera ready. Start recording when you are ready.");
      controls();
      opened.getVideoTracks()[0].addEventListener("ended", () => {
        if (mode === "recording") button("stop").click();
        else if (mode === "camera") {
          stopCamera();
          mode = "empty";
          controls();
          status("Camera disconnected. Enable it again to continue.", true);
        }
      });
    } catch (e) {
      if (generation !== sourceGeneration && mode !== "camera") return;
      stopCamera();
      mode = media ? "clip" : "empty";
      controls();
      status(
        `Camera could not start: ${errorText(e)}. You can open a local video or disable microphone audio and retry.`,
        true,
      );
    }
  };
  button("camera-off").onclick = () => {
    stopCamera();
    mode = "empty";
    el("source").textContent = "No video loaded";
    controls();
    status("Camera turned off.");
  };
  button("record").onclick = () => {
    if (!stream) return;
    try {
      const mime = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(
        stream,
        mime
          ? { mimeType: mime, videoBitsPerSecond: 4000000 }
          : { videoBitsPerSecond: 4000000 },
      );
      const chunks = [];
      let bytes = 0;
      const current = recorder;
      const generation = sourceGeneration;
      current.ondataavailable = ({ data }) => {
        if (data.size) {
          chunks.push(data);
          bytes += data.size;
        }
        if (
          bytes >= MAX_BYTES - 5 * 1024 * 1024 &&
          current.state === "recording"
        )
          current.stop();
      };
      current.onstop = () => {
        clearInterval(recordTimer);
        const elapsed = (performance.now() - recordStart) / 1000;
        stopCamera();
        recorder = null;
        if (generation !== sourceGeneration) return;
        const blob = new Blob(chunks, { type: current.mimeType });
        void loadClip(
          blob,
          `recording-${new Date().toISOString().replaceAll(":", "-")}.${current.mimeType.includes("mp4") ? "mp4" : "webm"}`,
          elapsed,
        );
      };
      current.onerror = () => {
        status(
          "Recording failed. Try a different recording size or browser.",
          true,
        );
        if (current.state !== "inactive") current.stop();
      };
      current.start(500);
      recordStart = performance.now();
      mode = "recording";
      controls();
      recordTimer = setInterval(() => {
        const elapsed = (performance.now() - recordStart) / 1000;
        status(
          `Recording · ${elapsed.toFixed(1)} s · ${(bytes / 1024 / 1024).toFixed(1)} MB`,
        );
        if (elapsed >= MAX_SECONDS && current.state === "recording")
          current.stop();
      }, 200);
    } catch (e) {
      status(`Recording could not start: ${errorText(e)}`, true);
    }
  };
  button("stop").onclick = () => {
    if (recorder?.state === "recording") {
      button("stop").disabled = true;
      recorder.stop();
    }
  };
  input("file").onchange = () => {
    const file = input("file").files?.[0];
    if (file) void loadClip(file, file.name);
  };
  button("reset").onclick = reset;
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  button("download").onclick = () => {
    if (media) download(media, mediaName);
  };
  button("analyze").onclick = async () => {
    const start = Number(input("start").value),
      end = Number(input("end").value),
      fps = Number(select("fps").value),
      people = Number(select("people").value);
    const eyeDistance = input("calibration").value
      ? Number(input("calibration").value)
      : null;
    if (
      !finite(start) ||
      !finite(end) ||
      start < 0 ||
      end <= start ||
      end > duration + 0.001
    ) {
      status(
        "Choose a start and end inside the video, with end after start.",
        true,
      );
      return;
    }
    if (Math.ceil((end - start) * fps) * people > MAX_FRAMES) {
      status(
        "This interval exceeds 4,500 samples across the selected people. Shorten it, lower the sample rate, or select fewer people.",
        true,
      );
      return;
    }
    if (
      eyeDistance !== null &&
      (!finite(eyeDistance) ||
        eyeDistance < 30 ||
        eyeDistance > 150 ||
        people !== 1)
    ) {
      status(
        "Calibration needs a measured outer-eye distance of 30–150 mm and the single-person setting.",
        true,
      );
      return;
    }
    const generation = sourceGeneration;
    video.pause();
    clearResults();
    mode = "analyzing";
    stopped = false;
    controls();
    run = {
      start,
      end,
      fps,
      people,
      posture: input("pose").checked,
      eyeDistance,
      units: eyeDistance ? "approximate_2d_mm" : "outer_eye_distance",
      partial: true,
      reason: "in_progress",
      sampledFrames: 0,
    };
    el("progress").hidden = false;
    el("progress").value = 0;
    status("Loading face and posture models for local analysis…");
    const faceTracker = new TrackManager(),
      poseTracker = new TrackManager();
    try {
      worker = new Worker(new URL("./inference.worker.js", import.meta.url));
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(data.id);
        data.error ? p.reject(new Error(data.error)) : p.resolve(data);
      };
      worker.onerror = (e) => {
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(e.message || "Analysis worker failed"));
        }
        pending.clear();
      };
      await ask({ type: "init", people, pose: run.posture });
      const count = Math.ceil((end - start) * fps);
      for (let index = 0; index < count; index++) {
        if (stopped || generation !== sourceGeneration) break;
        const time = start + index / fps;
        await seek(time);
        if (stopped || generation !== sourceGeneration) break;
        const bitmap = await createImageBitmap(video);
        if (stopped || generation !== sourceGeneration) {
          bitmap.close();
          break;
        }
        const result = await ask(
          { type: "frame", bitmap, timestamp: time * 1000 },
          [bitmap],
          30000,
        );
        const faces = result.faces.faceLandmarks,
          poses = result.poses?.landmarks ?? [];
        const boxes = faces.map(faceBox),
          ids = faceTracker.update(boxes, time),
          poseIds = poseTracker.update(poses.map(faceBox), time);
        const assignedPoses = new Set();
        const persons = faces.map((points, i) => {
          const shapes = result.faces.faceBlendshapes[i]?.categories ?? [];
          return {
            id: `F${ids[i].id}`,
            kind: "face",
            ambiguous: ids[i].ambiguous,
            face: points,
            blendshapes: shapes,
            transform: result.faces.facialTransformationMatrixes[i],
            metrics: faceMetrics(
              points,
              shapes,
              video.videoWidth,
              video.videoHeight,
              eyeDistance,
            ),
          };
        });
        // Associate a pose only if its visible nose lies inside a unique face box.
        for (let p = 0; p < poses.length; p++) {
          const nose = poses[p][0];
          if (!nose || (nose.visibility ?? 0) < 0.6) continue;
          const matches = boxes
            .map((b, i) => ({ b, i }))
            .filter(
              ({ b }) =>
                Math.abs(nose.x - b.x) < b.w * 0.6 &&
                Math.abs(nose.y - b.y) < b.h * 0.6,
            );
          if (matches.length === 1) {
            const person = persons[matches[0].i];
            if (person.pose) continue;
            person.pose = poses[p];
            person.worldPose = result.poses?.worldLandmarks[p];
            person.metrics = {
              ...person.metrics,
              ...poseMetrics(poses[p], video.videoWidth, video.videoHeight),
            };
            assignedPoses.add(p);
          }
        }
        poses.forEach((points, p) => {
          if (!assignedPoses.has(p))
            persons.push({
              id: `P${poseIds[p].id}`,
              kind: "pose",
              ambiguous: poseIds[p].ambiguous,
              pose: points,
              worldPose: result.poses?.worldLandmarks[p],
              metrics: poseMetrics(points, video.videoWidth, video.videoHeight),
            });
        });
        frames.push({ time, people: persons });
        run.sampledFrames = frames.length;
        el("progress").value = (index + 1) / count;
        if (index % 5 === 0 || index === count - 1) {
          status(
            `Analyzing ${time.toFixed(2)} / ${end.toFixed(2)} s · ${index + 1}/${count} frames · ${persons.length} tracks in frame`,
          );
          drawOverlay();
        }
      }
      if (generation !== sourceGeneration) return;
      run.partial = stopped;
      run.reason = stopped ? "cancelled" : "complete";
      status(
        stopped
          ? `Analysis cancelled. ${frames.length} completed frames are available to export.`
          : `Analysis complete · ${frames.length} sampled frames. Select a person to explore their signals.`,
      );
    } catch (e) {
      if (generation !== sourceGeneration) return;
      run.partial = true;
      run.reason = stopped ? "cancelled" : errorText(e);
      status(
        stopped
          ? `Analysis cancelled. ${frames.length} completed frames retained.`
          : `Analysis stopped: ${errorText(e)}. ${frames.length} completed frames retained.`,
        !stopped,
      );
    } finally {
      if (generation === sourceGeneration) {
        terminateWorker();
        mode = "clip";
        el("progress").hidden = true;
        refreshTracks();
        controls();
        await seek(start).catch(() => {});
        drawOverlay();
      }
    }
  };
  button("cancel").onclick = () => {
    stopped = true;
    terminateWorker();
  };
  function rowsFor(id) {
    return frames.flatMap((f) => {
      const p = f.people.find((p) => p.id === id);
      return p
        ? [
            {
              time: f.time,
              ...p,
              audioRms:
                audio && f.time < audio.duration
                  ? audio.rms[
                      Math.min(
                        audio.rms.length - 1,
                        Math.floor(
                          (f.time / audio.duration) * audio.rms.length,
                        ),
                      )
                    ]
                  : null,
            },
          ]
        : [];
    });
  }
  function refreshTracks() {
    const ids = [...new Set(frames.flatMap((f) => f.people.map((p) => p.id)))];
    select("track").replaceChildren(
      ...(ids.length
        ? ids.map(
            (id) =>
              new Option(
                `${id.startsWith("F") ? "Face" : "Posture"} track ${id}`,
                id,
              ),
          )
        : [new Option("No people detected", "")]),
    );
    updateSummary();
  }
  function updateSummary() {
    const rows = rowsFor(select("track").value);
    const container = el("metrics");
    container.replaceChildren();
    if (!rows.length) {
      container.textContent = frames.length
        ? "No detections for this track. Try better lighting or a closer view."
        : "Movement and coordination summaries will appear here.";
      drawMotion();
      return;
    }
    const summary = summarize(rows, 1 / (run?.fps ?? 15));
    const units = run?.eyeDistance ? "mm" : "eye units";
    const metrics = [
      ["Lip aperture range · " + units, summary.lipApertureRange],
      ["Mean lower-lip speed · " + units + "/s", summary.lowerLipMeanSpeed],
      ["Lip–jaw coordination · r", summary.lipJawCorrelation],
      ["Left–right smile · r", summary.bilateralSmileCorrelation],
      ["Mean smile asymmetry · 0–1", summary.meanSmileAsymmetry],
      ["Mouth–audio association · r", summary.mouthAudioCorrelation],
    ];
    for (const [label, value] of metrics) {
      const div = document.createElement("div");
      div.className = "vw-metric";
      const number = document.createElement("strong");
      number.textContent = format(value);
      const text = document.createElement("span");
      text.textContent = label;
      div.append(number, text);
      container.append(div);
    }
    el("track-info").textContent =
      `${rows.length}/${frames.length} sampled frames · ${rows[0].time.toFixed(2)}–${rows.at(-1).time.toFixed(2)} s · ${rows.filter((r) => r.ambiguous).length} ambiguous starts. IDs follow geometry and can change with occlusion or crossing. ${run?.partial ? "Partial analysis." : ""}`;
    drawMotion();
    drawOverlay();
  }
  select("track").onchange = updateSummary;
  select("signal").onchange = drawMotion;
  for (const key of ["show-face", "show-pose", "follow"])
    input(key).onchange = drawOverlay;
  function currentFrame() {
    if (!run || !frames.length) return null;
    const index = Math.round((video.currentTime - run.start) * run.fps);
    const frame = frames[Math.max(0, Math.min(frames.length - 1, index))];
    return Math.abs(frame.time - video.currentTime) <= 0.65 / run.fps
      ? frame
      : null;
  }
  function drawOverlay() {
    const width = video.videoWidth || 1280,
      height = video.videoHeight || 720;
    overlay.width = width;
    overlay.height = height;
    const scale = Math.min(
      video.clientWidth / width,
      video.clientHeight / height,
    );
    overlay.style.width = `${width * scale}px`;
    overlay.style.height = `${height * scale}px`;
    overlay.style.left = `${(video.clientWidth - width * scale) / 2}px`;
    overlay.style.top = `${(video.clientHeight - height * scale) / 2}px`;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const frame = currentFrame(),
      selected = select("track").value;
    if (frame) {
      for (const person of frame.people) {
        if (input("follow").checked && person.id !== selected) continue;
        ctx.strokeStyle = ctx.fillStyle =
          colors[(Number(person.id.slice(1)) - 1) % colors.length];
        ctx.lineWidth = Math.max(1, width / 700);
        const dot = (p) => {
          ctx.beginPath();
          ctx.arc(
            p.x * width,
            p.y * height,
            Math.max(1, width / 850),
            0,
            2 * Math.PI,
          );
          ctx.fill();
        };
        if (person.face && input("show-face").checked) person.face.forEach(dot);
        if (person.pose && input("show-pose").checked) {
          const connections = [
            [11, 12],
            [11, 13],
            [13, 15],
            [12, 14],
            [14, 16],
            [11, 23],
            [12, 24],
            [23, 24],
            [23, 25],
            [25, 27],
            [24, 26],
            [26, 28],
          ];
          for (const [a, b] of connections) {
            const p = person.pose[a],
              q = person.pose[b];
            if ((p.visibility ?? 0) < 0.6 || (q.visibility ?? 0) < 0.6)
              continue;
            ctx.beginPath();
            ctx.moveTo(p.x * width, p.y * height);
            ctx.lineTo(q.x * width, q.y * height);
            ctx.stroke();
          }
          person.pose.filter((p) => (p.visibility ?? 0) >= 0.6).forEach(dot);
        }
        const box = faceBox(person.face ?? person.pose ?? []);
        ctx.font = `600 ${Math.max(14, width / 60)}px sans-serif`;
        ctx.fillText(
          `${person.id}${person.ambiguous ? " ?" : ""}`,
          Math.max(0, (box.x - box.w / 2) * width),
          Math.max(20, (box.y - box.h / 2) * height - 8),
        );
      }
    }
    const person = frame?.people.find((p) => p.id === selected);
    const expressions = el("expressions");
    expressions.replaceChildren();
    for (const [label, key] of [
      ["Jaw open", "jawOpen"],
      ["Smile left", "smileLeft"],
      ["Smile right", "smileRight"],
      ["Blink left", "blinkLeft"],
      ["Blink right", "blinkRight"],
      ["Brow raise", "browRaise"],
    ]) {
      const row = document.createElement("div");
      row.className = "vw-expression";
      const text = document.createElement("span");
      text.textContent = label;
      const meter = document.createElement("meter");
      meter.min = 0;
      meter.max = 1;
      const value = person?.metrics?.[key];
      meter.value = finite(value) ? value : 0;
      meter.setAttribute("aria-label", label);
      const out = document.createElement("output");
      out.textContent = format(value, 2);
      row.append(text, meter, out);
      expressions.append(row);
    }
    el("clock").textContent = `${video.currentTime.toFixed(2)} s`;
    document
      .querySelectorAll(".vw-cursor")
      .forEach(
        (c) =>
          (c.style.left = `${duration ? Math.min(100, (video.currentTime / duration) * 100) : 0}%`),
      );
  }
  function canvas(id) {
    const c = el(id);
    c.width = Math.max(260, Math.round(c.clientWidth || 900));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#111b29";
    ctx.fillRect(0, 0, c.width, c.height);
    return { c, ctx };
  }
  function axes(ctx, width, height) {
    ctx.strokeStyle = "#ffffff15";
    ctx.fillStyle = "#9dafc2";
    ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const x = (i * (width - 1)) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(
        ((duration * i) / 4).toFixed(1) + " s",
        Math.min(x + 4, width - 45),
        height - 5,
      );
    }
  }
  function drawMotion() {
    const { c, ctx } = canvas("motion");
    axes(ctx, c.width, c.height);
    const rows = rowsFor(select("track").value),
      key = select("signal").value;
    const values = rows.map((r) => r.metrics?.[key]).filter(finite);
    const coefficient = ["jawOpen", "smileAsymmetry"].includes(key),
      angle = ["headRoll", "shoulderTilt", "torsoLean"].includes(key);
    el("motion-unit").textContent = coefficient
      ? "Model coefficient · 0–1"
      : angle
        ? "Image-plane degrees"
        : run?.eyeDistance
          ? "Approximate image-plane mm"
          : "Outer-eye distance units";
    if (!values.length) {
      ctx.fillStyle = "#9dafc2";
      ctx.fillText(
        "Analyze a clip to explore movement.",
        20,
        70,
      );
      return;
    }
    const lo = Math.min(...values),
      hi = Math.max(...values),
      range = hi - lo || 1;
    ctx.strokeStyle = "#58d5c6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let previous = null;
    for (const row of rows) {
      const v = row.metrics?.[key];
      if (!finite(v)) {
        previous = null;
        continue;
      }
      const x = (row.time / duration) * c.width,
        y = 15 + (1 - (v - lo) / range) * (c.height - 45);
      if (previous === null || row.time - previous > 1.6 / (run?.fps ?? 15))
        ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      previous = row.time;
    }
    ctx.stroke();
    ctx.fillStyle = "#c5d7e6";
    ctx.fillText(`${format(lo)} – ${format(hi)}`, 10, 14);
  }
  function drawAudio() {
    const wave = canvas("wave"),
      spec = canvas("spec");
    if (!audio) {
      for (const { ctx } of [wave, spec]) {
        ctx.fillStyle = "#9dafc2";
        ctx.font = "12px sans-serif";
        ctx.fillText("Audio will appear here when available.", 20, 45);
      }
      return;
    }
    wave.ctx.strokeStyle = "#83b8fa";
    wave.ctx.beginPath();
    audio.wave.forEach(([lo, hi], i) => {
      const x =
        (((i / audio.wave.length) * audio.duration) / duration) * wave.c.width;
      wave.ctx.moveTo(x, (0.5 - hi * 0.42) * (wave.c.height - 20));
      wave.ctx.lineTo(x, (0.5 - lo * 0.42) * (wave.c.height - 20));
    });
    wave.ctx.stroke();
    axes(wave.ctx, wave.c.width, wave.c.height);
    const pixels = spec.ctx.createImageData(spec.c.width, spec.c.height);
    for (let x = 0; x < spec.c.width; x++) {
      const time = (x / spec.c.width) * duration;
      const col = Math.floor((time / audio.duration) * audio.db.length);
      if (col >= audio.db.length) continue;
      for (let y = 0; y < spec.c.height - 20; y++) {
        const bin = Math.min(127, Math.floor((1 - y / (spec.c.height - 20)) * 128));
        const v = Math.max(0, Math.min(1, (audio.db[col][bin] + 80) / 80));
        const at = (y * spec.c.width + x) * 4;
        pixels.data[at] = Math.round(17 + 238 * v * v);
        pixels.data[at + 1] = Math.round(27 + 193 * v);
        pixels.data[at + 2] = Math.round(41 + 110 * Math.sin(v * Math.PI));
        pixels.data[at + 3] = 255;
      }
    }
    spec.ctx.putImageData(pixels, 0, 0);
    axes(spec.ctx, spec.c.width, spec.c.height);
    el("frequency").textContent =
      `Frequency · 0–${audio.maxHz / 1000} kHz (bottom to top)`;
  }
  for (const id of ["motion", "wave", "spec"]) {
    el(id).onclick = (e) => {
      if (mode !== "clip" || !duration) return;
      const rect = el(id).getBoundingClientRect();
      video.currentTime = Math.max(
        0,
        Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration),
      );
    };
  }
  video.addEventListener("timeupdate", drawOverlay);
  video.addEventListener("seeked", drawOverlay);
  let animation = 0;
  function animate() {
    drawOverlay();
    if (!video.paused && mode === "clip")
      animation = requestAnimationFrame(animate);
  }
  video.addEventListener("play", () => {
    cancelAnimationFrame(animation);
    if (mode === "clip") animate();
  });
  const observer = new ResizeObserver(() => {
    drawOverlay();
    drawMotion();
    drawAudio();
  });
  observer.observe(video);
  const exportData = () => ({
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),
    buildVersion: BUILD_VERSION,
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: window.isSecureContext,
    },
    source: {
      name: mediaName,
      type: media?.type,
      bytes: media?.size,
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
    },
    models: MODEL_INFO,
    processing: {
      ...run,
      faceCoordinates:
        "x/image width, y/image height; z relative to image width",
      poseWorldCoordinates: "model-estimated meters",
      normalization:
        "2D eye-centered, roll-corrected, divided by outer-eye distance",
      filter: "none",
      tracking:
        "geometry/velocity; 0.8 s expiry; ambiguous match starts new segment",
      visibilityThreshold: 0.6,
      correlation: "zero-lag Pearson; minimum 3 pairs; audio is mixed track",
      speed:
        "absolute first difference; gaps over 1.6 sample intervals excluded",
    },
    audio: audio ? { ...audio, db: undefined, wave: undefined } : null,
    summaries: [
      ...new Set(frames.flatMap((f) => f.people.map((p) => p.id))),
    ].map((id) => ({ id, ...summarize(rowsFor(id), 1 / (run?.fps ?? 15)) })),
    frames,
  });
  button("json").onclick = () =>
    download(
      new Blob([JSON.stringify(exportData())], { type: "application/json" }),
      "video-analysis.json",
    );
  button("csv").onclick = () => {
    const rows = frames.flatMap((f) =>
      (f.people.length
        ? f.people
        : [{ id: "", kind: "no_detection", ambiguous: false }]
      ).map((p) => ({
        time_seconds: f.time,
        track_id: p.id,
        track_kind: p.kind,
        ambiguous: p.ambiguous,
        partial_analysis: run?.partial,
        geometry_units: run?.units,
        sample_rate: run?.fps,
        calibration_eye_mm: run?.eyeDistance,
        ...p.metrics,
        ...Object.fromEntries(
          (p.blendshapes ?? []).map((s) => [
            `blendshape_${s.categoryName}`,
            s.score,
          ]),
        ),
        audio_rms:
          audio && f.time < audio.duration
            ? audio.rms[
                Math.min(
                  audio.rms.length - 1,
                  Math.floor((f.time / audio.duration) * audio.rms.length),
                )
              ]
            : null,
      })),
    );
    download(
      new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }),
      "video-measures.csv",
    );
  };
  window.addEventListener("pagehide", () => {
    release();
    observer.disconnect();
    cancelAnimationFrame(animation);
  });
  drawAudio();
  drawMotion();
  controls();
  if (!window.isSecureContext)
    status(
      "Camera access needs HTTPS or localhost. Local file analysis is available.",
      true,
    );
}
