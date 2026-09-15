let face;
let pose;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const { MODEL_INFO } = await import("./models.js");
      const { FaceLandmarker, PoseLandmarker, FilesetResolver } = await import(
        MODEL_INFO.bundle
      );
      face?.close();
      pose?.close();
      face = undefined;
      pose = undefined;
      const files = await FilesetResolver.forVisionTasks(MODEL_INFO.wasm);
      // CPU supports classic workers without relying on an OffscreenCanvas WebGL context.
      // VIDEO mode adds internal causal smoothing for single-person landmarks.
      // Independent IMAGE estimates preserve raw sample timing; our caller still
      // schedules continuously and associates identities across frames.
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_INFO.face, delegate: "CPU" },
        runningMode: "IMAGE",
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
          runningMode: "IMAGE",
          numPoses: data.people,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      self.postMessage({
        id: data.id,
        ready: true,
        faceConnections: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
      });
    } else if (data.type === "frame") {
      try {
        const faces = face.detect(data.bitmap);
        const poses = pose?.detect(data.bitmap);
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
