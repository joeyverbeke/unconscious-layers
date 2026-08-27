import { openCamera } from "./camera.js";
import { createFaceLandmarker, modelCounts } from "./vision.js";
import { mapFaceFeatures, faceScaleOf } from "./faceFeatures.js";
import { createBlinkPipeline } from "./blinkPipeline.js";
import { createDiscovery } from "./blink/discovery.js";
import { createParticipant } from "./participant.js";
import { createEngagement } from "../experience/engagement.js";
import { mapBlinkSettings, mapDiscoverySettings } from "./tuning.js";

/**
 * One camera, one FaceLandmarker. The person is drawn from face landmarks
 * alone — there is no segmentation and no silhouette.
 *
 * Everything downstream — the face marks, blink detection,
 * the discovery determiner and participant identity — is fed from those, so
 * the page never runs a second copy of a model.
 */
export function createPerception({ settings, flags, canvasSize }) {
  const listeners = new Map();
  const emit = (event, payload) => {
    for (const handler of listeners.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`perception "${event}" listener failed:`, error);
      }
    }
  };

  const blinkPipeline = createBlinkPipeline({
    config: mapBlinkSettings(settings),
    normalize: settings.blinkNormalize,
  });

  const discovery = createDiscovery(mapDiscoverySettings(settings));

  const participant = createParticipant({
    // Identity bookkeeping only. The visible behaviour is governed by the
    // engagement gate, which clears everything the moment somebody walks away;
    // this just decides when a face that has gone counts as a finished session.
    absenceEndsSession: 3,
    identityTolerance: settings.identityTolerance,
    swapConfirm: settings.identitySwapConfirmMs / 1000,
    onStart: (sessionId) => emit("participant", { type: "start", sessionId }),
    onEnd: (why, sessionId) => emit("participant", { type: "end", why, sessionId }),
  });

  const engagement = createEngagement({
    settings,
    onChange: (state) => emit("engagement", state),
  });

  discovery.onDiscovered((report) => emit("discovery", { report }));


  let camera = null;
  let faceLandmarker = null;
  let running = false;

  // MediaPipe demands strictly increasing timestamps per task instance, and
  // performance.now() can repeat on a coarse clock. Each task gets its own.
  let lastFaceStamp = 0;
  let lastSegStamp = 0;
  const stampFace = () => (lastFaceStamp = Math.max(lastFaceStamp + 1, performance.now()));
  const stampSeg = () => (lastSegStamp = Math.max(lastSegStamp + 1, performance.now()));

  const latest = {
    at: 0,
    hasFace: false,
    faces: 0,
    faceScale: 0,
    latency: 0,
    cameraFps: 0,
    raw: { left: 0, right: 0 },
    closure: { left: 0, right: 0 },
    blocked: null,
    reason: null,
    closed: false,
    delegates: { face: null },
    cameraSettings: {},
  };

  // Camera-rate frame counter, for the readout.
  let frameTicks = 0;
  let frameWindowStart = 0;

  async function start() {
    try {
      camera = await openCamera({ width: 1280, height: 720, frameRate: 30 });
      latest.cameraSettings = camera.settings;
      emit("video", camera.video);
    } catch (error) {
      console.error("Camera unavailable:", error);
      emit("error", { message: "Camera unavailable — the painting continues alone.", fatal: true });
      return;
    }

    const delegate = flags.delegate === "cpu" ? "CPU" : "GPU";
    try {
      const face = await createFaceLandmarker({ delegate });
      faceLandmarker = face.task;
      latest.delegates.face = face.delegate;

    } catch (error) {
      console.error("Vision models unavailable:", error);
      emit("error", { message: "Vision models unavailable.", fatal: true });
      return;
    }

    running = true;
    startFastLoop();
    startSlowLoop();
  }

  // ---- Loop A: camera rate. A blink is 100-150ms, so this must not be
  // throttled — at 30fps it yields only 3-4 samples through one blink.
  function startFastLoop() {
    const video = camera.video;

    const tick = () => {
      if (!running) return;
      try {
        runFaceFrame(video);
      } catch (error) {
        console.error("Face tracking stopped:", error);
        running = false;
        emit("error", { message: "Face tracking stopped.", fatal: false });
        return;
      }
      schedule();
    };

    let lastVideoTime = -1;
    const schedule = () => {
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(() => tick());
      } else {
        requestAnimationFrame(() => {
          if (video.currentTime === lastVideoTime) return schedule();
          lastVideoTime = video.currentTime;
          tick();
        });
      }
    };
    schedule();
  }

  function runFaceFrame(video) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const at = stampFace();
    const startedAt = performance.now();
    const results = faceLandmarker.detectForVideo(video, at);
    const latency = performance.now() - startedAt;

    const points = results.faceLandmarks?.[0] ?? null;
    const categories = results.faceBlendshapes?.[0]?.categories;
    const matrix = results.facialTransformationMatrixes?.[0] ?? null;
    const hasFace = !!points;

    // By name, never by index. The indexes are stable in practice, but a
    // silent off-by-one here looks like a detection problem for weeks.
    const rawLeft = scoreByName(categories, "eyeBlinkLeft");
    const rawRight = scoreByName(categories, "eyeBlinkRight");

    // (d) blink -> the reveal
    const blink = blinkPipeline.frame({
      left: rawLeft,
      right: rawRight,
      points,
      matrix,
      at,
      hasFace,
    });
    if (blink.changed) emit("blink", { closed: blink.closed, at });

    // (e) discovery -> RAW, UNGATED, per-eye. It runs its OWN normalizer
    // (discovery.js:198); feeding it the already-normalized closure would
    // normalize twice and silently ruin the squint and hold channels, which
    // are the two that read absolute levels.
    discovery.frame({
      at,
      left: rawLeft,
      right: rawRight,
      hasFace,
      pose: blink.face,
    });

    // (f) identity. Judging identity on a turned head produces false swaps,
    // and a false swap clears the sentence — so reuse the gates' own measure.
    const visible = blink.face?.visible ?? 0;
    participant.saw(hasFace && visible >= settings.identityMinVisible ? points : null);

    // (c) eyes + mouth, in canvas space
    const { width, height } = canvasSize();
    const featurePoints = hasFace ? mapFaceFeatures(points, video, width, height) : [];

    // (a) the proximity half of engagement
    const faceScale = hasFace ? faceScaleOf(points) : 0;
    engagement.updateFace({ hasFace, scale: faceScale, at });

    frameTicks += 1;
    if (frameWindowStart === 0) frameWindowStart = at;
    else if (at - frameWindowStart >= 1000) {
      latest.cameraFps = (frameTicks * 1000) / (at - frameWindowStart);
      frameTicks = 0;
      frameWindowStart = at;
    }

    Object.assign(latest, {
      at,
      hasFace,
      faces: results.faceLandmarks?.length ?? 0,
      faceScale,
      latency,
      raw: { left: rawLeft, right: rawRight },
      closure: blink.closure,
      blocked: { ...blinkPipeline.blocked },
      reason: blink.reason,
      closed: blink.closed,
    });

    emit("face", {
      at,
      points,
      featurePoints,
      hasFace,
      faceScale,
      matrix,
      face: blink.face,
      raw: latest.raw,
      closure: blink.closure,
      latency,
    });
  }

  // The determiner, with the bar moved according to whether this person has
  // already shown they know. The first finding has to be convincing; the second
  // does not — they demonstrated it a moment ago and are plainly doing it again
  // on purpose. config is mutable by design, so this needs no change to
  // discovery.js.
  let barLowered = false;

  const applyBar = () => {
    discovery.config.discovered = barLowered
      ? settings.discoveryRetrigger
      : settings.discoveryDiscovered;
  };

  const discoveryHandle = {
    frame: (input) => discovery.frame(input),
    report: () => discovery.report(),
    onDiscovered: (listener) => discovery.onDiscovered(listener),
    get config() { return discovery.config; },
    get barLowered() { return barLowered; },

    // Same person, still standing there: keep their calibration and baseline.
    rearm() {
      discovery.rearm();
      barLowered = true;
      applyBar();
    },

    // Somebody else's turn — the bar goes back up with everything else.
    reset() {
      discovery.reset();
      barLowered = false;
      applyBar();
    },
  };

  function reconfigure(key) {
    if (key === "all" || key.startsWith("blink")) {
      Object.assign(blinkPipeline.config, mapBlinkSettings(settings));
    }
    if (key === "all" || key.startsWith("discovery")) {
      Object.assign(discovery.config, mapDiscoverySettings(settings));
      // mapDiscoverySettings always writes the full-strength bar, so put the
      // lowered one back if this person has already earned it.
      applyBar();
    }
    if (key === "blinkNormalize") blinkPipeline.setNormalize(settings.blinkNormalize);
  }

  return {
    start,
    stop() {
      running = false;
      camera?.stop();
      faceLandmarker?.close();
    },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
    },
    reconfigure,
    latest,
    modelCounts,
    handles: { blinkPipeline, discovery: discoveryHandle, participant, engagement },
  };
}

function scoreByName(categories, name) {
  if (!categories) return 0;
  for (const category of categories) {
    if (category.categoryName === name) return category.score;
  }
  return 0;
}
