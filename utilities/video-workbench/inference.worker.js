let face;
let pose;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const { MODEL_INFO } = await import("./models.js");
      const { FaceLandmarker, PoseLandmarker, FilesetResolver } = await import(MODEL_INFO.bundle);
      face?.close();
      pose?.close();
      face = undefined;
      pose = undefined;
      const files = await FilesetResolver.forVisionTasks(MODEL_INFO.wasm);
      // CPU supports classic workers without relying on an OffscreenCanvas WebGL context.
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_INFO.face, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: data.people,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (data.pose)
        pose = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_INFO.pose, delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses: data.people,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      self.postMessage({ id: data.id, ready: true });
    } else if (data.type === "frame") {
      try {
        const faces = face.detectForVideo(data.bitmap, data.timestamp);
        const poses = pose?.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ id: data.id, faces, poses });
      } finally {
        data.bitmap.close();
      }
    }
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
