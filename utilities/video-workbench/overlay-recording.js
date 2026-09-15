/** Record the visible camera composition separately from the original stream. */
export class OverlayRecording {
  constructor(video, audioTracks, paint, mime, onLimit) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    const ctx = this.canvas.getContext("2d");
    this.disposed = false;
    this.bytes = 0;
    this.error = null;
    const chunks = [];
    const draw = () => {
      if (this.disposed) return;
      ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      paint(ctx, this.canvas.width, this.canvas.height);
      this.animation = requestAnimationFrame(draw);
    };
    draw();
    this.stream = this.canvas.captureStream(30);
    for (const track of audioTracks) this.stream.addTrack(track.clone());
    try {
      this.recorder = new MediaRecorder(this.stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 4000000,
      });
      this.completed = new Promise((resolve) => {
        this.recorder.ondataavailable = ({ data }) => {
          if (data.size && !this.disposed) {
            chunks.push(data);
            this.bytes += data.size;
            onLimit(this.bytes);
          }
        };
        this.recorder.onerror = () => {
          this.error = "Overlay video encoder failed";
          if (this.recorder.state !== "inactive") this.recorder.stop();
        };
        this.recorder.onstop = () => {
          this.stopDrawing();
          resolve({
            blob:
              this.disposed || this.error
                ? null
                : new Blob(chunks, { type: this.recorder.mimeType }),
            error: this.error,
          });
        };
      });
      this.startedAt = performance.now();
      this.recorder.start(500);
    } catch (error) {
      this.stopDrawing();
      throw error;
    }
  }
  stopDrawing() {
    cancelAnimationFrame(this.animation);
    this.stream?.getTracks().forEach((t) => t.stop());
  }
  async stop() {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    let timer;
    const result = await Promise.race([
      this.completed,
      new Promise((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              blob: null,
              error: "Overlay encoder finalization timed out",
            }),
          10000,
        );
      }),
    ]);
    clearTimeout(timer);
    this.stopDrawing();
    return result;
  }
  discard() {
    this.disposed = true;
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.stopDrawing();
  }
}
