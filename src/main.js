import { DEFAULT_SETTINGS } from "./settings/defaults.js";
import { flags } from "./settings/flags.js";
import { applyTier, createTierGovernor } from "./settings/tiers.js";
import { createDebugPanel, loadSettings, clearSavedSettings } from "./settings/debugPanel.js";
import { createPainting } from "./painting/painting.js";
import { createPerception } from "./perception/perception.js";
import { createExperience, STATE } from "./experience/experienceState.js";
import { createRevealImage } from "./experience/revealImage.js";
import { createRevealText } from "./experience/revealText.js";

// Must happen before loadSettings, or the saved blob wins again.
if (flags.resetSettings) clearSavedSettings({ palettes: false });

const settings = loadSettings(applyTier(DEFAULT_SETTINGS, flags));
const cameraError = document.querySelector("#camera-error");

let debugPanel;

const painting = createPainting({
  mount: "stage",
  settings,
  flags,
  onStats: (objectCount, framesPerSecond) => debugPanel?.updateStats(objectCount, framesPerSecond),
});

const perception = createPerception({
  settings,
  flags,
  canvasSize: () => painting.size,
});

debugPanel = createDebugPanel({
  settings,
  defaults: DEFAULT_SETTINGS,
  onChange: (key) => {
    painting.handleSettingsChange(key);
    perception.reconfigure(key);
  },
});

// ---- perception -> painting ------------------------------------------------
perception.on("video", (video) => debugPanel.attachCamera(video));

perception.on("mask", ({ mask, width, height, coverage }) => {
  painting.updateMask({ mask, width, height, coverage });
  debugPanel.updateMask(mask, width, height);
});

perception.on("face", ({ featurePoints }) => painting.updateFacePoints(featurePoints));

perception.on("error", ({ message }) => {
  cameraError.textContent = message;
});

// ---- the experience --------------------------------------------------------
const revealImage = createRevealImage({ settings });
const revealText = createRevealText({ settings });

const experience = createExperience({
  settings,
  perception,
  painting,
  revealImage,
  revealText,
  flags,
});

if (import.meta.env.DEV && flags.forceDiscovery) {
  // Earn nothing; just prove the transition and the typography.
  setTimeout(() => {
    if (experience.state === STATE.ENGAGED) experience.forceState(STATE.DISCOVERED);
  }, 3000);
}

if (!flags.skipCamera) {
  perception.start();
} else {
  cameraError.textContent = "Camera skipped (?skipCamera=1).";
}

// ---- quality governor ------------------------------------------------------
// One step down, once, if this machine cannot hold a frame rate at startup.
const explicitTier = flags.tier && ["high", "medium", "low"].includes(flags.tier);
const governor = createTierGovernor({
  tier: explicitTier ? flags.tier : "high",
  // If a tier was named on the URL, that is a decision — do not overrule it.
  enabled: !explicitTier,
  onDowngrade: (name, overlay) => {
    console.warn(`Frame rate low — stepping quality down to "${name}".`);
    Object.assign(settings, overlay);
    painting.handleSettingsChange("all");
    perception.reconfigure("all");
    cameraError.textContent = `Quality reduced to ${name}.`;
  },
});

// ---- readout ---------------------------------------------------------------
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

setInterval(() => {
  // Before the panel guard: in the installation the panel is always hidden,
  // and the governor has to run there most of all.
  governor.sample(painting.frameRate(), performance.now());

  if (debugPanel.hidden) return;

  const l = perception.latest;
  const e = perception.handles.engagement.snapshot;
  const p = perception.handles.participant;

  const x = experience.snapshot();

  debugPanel.updateReadout("session", {
    state: x.eyesClosed ? `${x.state} · eyes closed` : x.state,
    for: seconds(x.timeInState),
    linger: x.sentenceRemaining === null ? "—" : `${seconds(x.sentenceRemaining)} left`,
    session: p.present
      ? `#${p.sessionId} · ${seconds((p.elapsed ?? 0) * 1000)} · ${x.triggerCount} trigger(s)`
      : "none",
    drift: p.drift === null ? "—" : p.drift.toFixed(3),
    "face scale": `${l.faceScale.toFixed(3)} (${e.reason})`,
    coverage: l.coverage.toFixed(4),
  });

  debugPanel.updateReadout("blink", {
    closure: `L ${l.closure.left.toFixed(2)}  R ${l.closure.right.toFixed(2)}${l.closed ? " · CLOSED" : ""}`,
    "eyes visible": l.hasFace ? "yes" : "no face",
    blocked: l.blocked
      ? `turn ${l.blocked.turned} · slow ${l.blocked.slow} · wink ${l.blocked.wink}`
      : "—",
    "camera fps": `${l.cameraFps.toFixed(0)} (${l.cameraSettings.width ?? "?"}x${l.cameraSettings.height ?? "?"} @${l.cameraSettings.frameRate ?? "?"})`,
    latency: `${l.latency.toFixed(1)} ms · ${l.delegates.face ?? "?"}`,
  });

  debugPanel.updateChannels(perception.handles.discovery.report());
}, 250);

if (import.meta.env.DEV) {
  Object.assign(window, {
    __painting: painting,
    __perception: perception,
    __experience: experience,
    __settings: settings,
    __revealImage: revealImage,
    __revealText: revealText,
    STATE,
  });
}
