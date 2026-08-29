const STORAGE_KEY = "unconscious-layers:12:settings:v1";
const PALETTE_STORAGE_KEY = "unconscious-layers:12:palettes:v1";

/**
 * Throw away everything saved, so the next load takes the defaults as written
 * in the source. Saved settings beat defaults (that is the point of the panel),
 * which means changing a default in code has no visible effect until this runs.
 */
export function clearSavedSettings({ palettes = false } = {}) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (palettes) localStorage.removeItem(PALETTE_STORAGE_KEY);
  } catch (error) {
    console.warn("Saved settings could not be cleared:", error);
  }
}
const FPS_SAMPLE_WINDOW = 8;

const CONTROL_SECTIONS = [
  { key: "visibility", label: "Visibility", open: true },
  { key: "painting", label: "Painting", open: true },
  {
    key: "blend",
    label: "Color blending",
    open: true,
    description:
      "Set the relative amount of each kind of paint. The three amounts do not need to add up to 100.",
  },
  { key: "tracking", label: "Tracked forms", open: false },
  { key: "motion", label: "Motion", open: false },
  { key: "engagement", label: "Engagement", open: false,
    description: "How close somebody has to be before the piece treats them as engaging with it. Face scale is the real proximity signal; calibrate it on site." },
  { key: "blink", label: "Blink", open: false },
  { key: "discovery", label: "Discovery", open: false,
    description: "Whether this person has worked out that blinking does something." },
  { key: "session", label: "Session", open: false },
  { key: "performance", label: "Performance", open: false },
  { key: "palette", label: "Palette", open: false },
];

// Readout groups are output-only: rows are rendered once and updated by
// updateReadout(). The panel previously had only updateStats.
const READOUT_GROUPS = [
  { key: "session", section: "session",
    rows: ["state", "for", "session", "linger", "drift", "face scale", "coverage"] },
  { key: "blink", section: "blink",
    rows: ["closure", "their open", "their shut", "eyes visible", "blocked", "camera fps", "latency"] },
  { key: "discovery", section: "discovery",
    rows: ["level", "score", "why", "blinks seen", "their rate", "run", "cadence", "calibration"] },
];

// The five evidence channels discovery.report() exposes.
const CHANNELS = [
  ["rapid", "rapid blinking"],
  ["shape", "blinks unlike their own"],
  ["hold", "eyes held shut"],
  ["wink", "one eye"],
  ["squint", "held squint"],
];

const BOOLEAN_CONTROLS = [
  {
    key: "drawFaceLandmarks",
    label: "Face landmarks",
    section: "visibility",
  },
  { key: "blinkGates", label: "Gates (reject squints/turns)", section: "blink" },
  { key: "blinkBothEyes", label: "Require both eyes", section: "blink" },
  { key: "blinkNormalize", label: "Normalize per person", section: "blink" },
  { key: "blinkInvertEnabled", label: "Invert on blink", section: "visibility" },
  { key: "lingerTimerEnabled", label: "Sentence lingers timer", section: "session" },
  { key: "rotatedSquares", label: "Rotate square marks", section: "performance" },
];

const NUMBER_CONTROLS = [
  {
    key: "objectCount",
    label: "Painting mark count",
    min: 500,
    max: 80000,
    step: 500,
    section: "painting",
  },
  {
    key: "primitivesPerSecond",
    label: "New marks per second",
    min: 1,
    max: 600,
    step: 1,
    section: "painting",
  },
  {
    key: "directionalFamilyPercent",
    label: "Typhoons following diagonals (%)",
    min: 0,
    max: 100,
    step: 1,
    section: "painting",
  },
  {
    key: "directionAngleVariationDegrees",
    label: "Typhoon angle variation (\u00b0)",
    min: 0,
    max: 45,
    step: 1,
    section: "painting",
  },
  {
    key: "directionObjectVariation",
    label: "Object placement variation (px)",
    min: 0,
    max: 80,
    step: 1,
    section: "painting",
  },
  {
    key: "maxTyphoonSize",
    label: "Largest gesture size",
    min: 10,
    max: 500,
    step: 1,
    section: "painting",
  },
  {
    key: "stainBlendWeight",
    label: "Dark stain amount",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "normalBlendWeight",
    label: "Regular paint amount",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "highlightBlendWeight",
    label: "Bright highlight amount",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "stainSizeMultiplier",
    label: "Stain size (1 = normal)",
    min: 0,
    sliderMax: 10,
    step: 0.05,
    section: "blend",
  },
  {
    key: "stainOpacityLowPercent",
    label: "Faintest stain opacity (%)",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "stainOpacityHighPercent",
    label: "Strongest stain opacity (%)",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "highlightOpacityLowPercent",
    label: "Faintest highlight opacity (%)",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "highlightOpacityHighPercent",
    label: "Strongest highlight opacity (%)",
    min: 0,
    max: 100,
    step: 1,
    section: "blend",
  },
  {
    key: "outlineApproachSpeedPixelsPerSecond",
    label: "Mark approach speed (px/s)",
    min: 10,
    max: 2000,
    step: 10,
    section: "motion",
  },
  {
    key: "maxFaceObjects",
    label: "Face mark limit (extras only)",
    min: 25,
    max: 2000,
    step: 25,
    section: "tracking",
  },
  {
    key: "maxOutlineObjectSize",
    label: "Largest mark borrowed for the face",
    min: 1,
    max: 100,
    step: 1,
    section: "tracking",
  },
  {
    key: "objectsPerFaceLandmark",
    label: "Marks per face point",
    min: 1,
    max: 10,
    step: 1,
    section: "tracking",
  },
  {
    key: "positionEasePerFrame",
    label: "Tracking responsiveness",
    min: 0.01,
    max: 0.5,
    step: 0.01,
    section: "motion",
  },
  {
    key: "perimeterMinSize",
    label: "Smallest tracked mark",
    min: 0.5,
    max: 100,
    step: 0.5,
    section: "tracking",
  },
  {
    key: "perimeterMaxSize",
    label: "Largest tracked mark",
    min: 0.5,
    max: 100,
    step: 0.5,
    section: "tracking",
  },
  {
    key: "perimeterSizeVariability",
    label: "Tracked mark size variation",
    min: 0,
    max: 1,
    step: 0.05,
    section: "tracking",
  },

  // engagement
  { key: "enterFaceScale", label: "Engage: face scale", min: 0, max: 0.6, step: 0.005, section: "engagement" },
  { key: "exitFaceScale", label: "Disengage: face scale", min: 0, max: 0.6, step: 0.005, section: "engagement" },
  { key: "engageDwellMs", label: "Engage hold (ms)", min: 0, max: 3000, step: 50, section: "engagement" },
  { key: "disengageDwellMs", label: "Disengage hold (ms)", min: 0, max: 5000, step: 50, section: "engagement" },

  // blink
  { key: "blinkEnter", label: "Closed above", min: 0, max: 1.2, step: 0.01, section: "blink" },
  { key: "blinkExit", label: "Open below", min: 0, max: 1.2, step: 0.01, section: "blink" },
  { key: "blinkLead", label: "Lead the crossing (ms)", min: 0, max: 200, step: 5, section: "blink" },
  { key: "blinkSmooth", label: "Smoothing", min: 0, max: 0.9, step: 0.05, section: "blink" },
  { key: "blinkSlopeSmoothing", label: "Slope smoothing", min: 0, max: 0.9, step: 0.05, section: "blink" },
  { key: "blinkMinSpeed", label: "Minimum speed", min: 0, max: 0.02, step: 0.0005, section: "blink" },
  { key: "blinkMinVisible", label: "Eyes visible above", min: 0, max: 1, step: 0.01, section: "blink" },
  { key: "blinkMaxTurn", label: "Head turn limit (deg)", min: 0, max: 90, step: 1, section: "blink" },
  { key: "blinkMaxPartialMs", label: "Partial closure timeout (ms)", min: 100, max: 2000, step: 25, section: "blink" },

  // discovery
  { key: "discoverySuspect", label: "Suspect above", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryDiscovered", label: "Discovered above", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryTauMs", label: "Evidence half-life (ms)", min: 5000, max: 120000, step: 1000, section: "discovery" },
  { key: "discoveryRapidMaxMs", label: "Rapid blink gap ceiling (ms)", min: 200, max: 3000, step: 50, section: "discovery" },
  { key: "discoveryRapidMinRun", label: "Rapid run minimum", min: 1, max: 6, step: 1, section: "discovery" },
  { key: "discoveryRetrigger", label: "Bar, second time onward", min: 0, max: 1, step: 0.01, section: "discovery" },

  // One clear performance of a signal earns its weight, so a weight at or above
  // the "discovered" bar means that signal alone is enough.
  { key: "discoveryWeightRapid", label: "Worth: rapid blinking", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryWeightHold", label: "Worth: eyes held shut", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryWeightWink", label: "Worth: one eye", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryWeightSquint", label: "Worth: held squint", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoveryWeightShape", label: "Worth: odd-shaped blinks", min: 0, max: 1, step: 0.01, section: "discovery" },

  { key: "discoveryHoldMinMs", label: "Hold counts from (ms)", min: 100, max: 3000, step: 50, section: "discovery" },
  { key: "discoveryHoldFullMs", label: "Hold full worth at (ms)", min: 200, max: 5000, step: 50, section: "discovery" },
  { key: "discoveryMinPeaks", label: "Closures before eyes are known", min: 1, max: 6, step: 1, section: "discovery" },
  { key: "discoveryCalibrationMs", label: "Shortest time before judging (ms)", min: 500, max: 15000, step: 250, section: "discovery" },
  { key: "discoveryCalibrationBlinks", label: "Blinks before judging", min: 1, max: 6, step: 1, section: "discovery" },
  { key: "discoveryCloseEnter", label: "Counts as shut above", min: 0.3, max: 1.2, step: 0.01, section: "discovery" },
  { key: "discoveryCloseExit", label: "Counts as open below", min: 0.1, max: 1, step: 0.01, section: "discovery" },
  { key: "discoverySquintBandLow", label: "Squint band low", min: 0, max: 1, step: 0.01, section: "discovery" },
  { key: "discoverySquintBandHigh", label: "Squint band high", min: 0, max: 1, step: 0.01, section: "discovery" },

  // session
  { key: "lingerMs", label: "Sentence lingers (ms)", min: 0, max: 60000, step: 250, section: "session" },
  { key: "identityTolerance", label: "Identity tolerance", min: 0, max: 0.5, step: 0.01, section: "session" },
  { key: "identitySwapConfirmMs", label: "Confirm a new person (ms)", min: 0, max: 8000, step: 100, section: "session" },

  // performance
];

export function loadSettings(defaults) {
  const settings = cloneSettings(defaults);

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return settings;

    for (const control of BOOLEAN_CONTROLS) {
      if (typeof saved[control.key] === "boolean") {
        settings[control.key] = saved[control.key];
      }
    }

    for (const control of NUMBER_CONTROLS) {
      const value = Number(saved[control.key]);
      if (Number.isFinite(value)) {
        settings[control.key] = normalizeNumber(control, value);
      }
    }

    if (isHexColor(saved.backgroundColor)) {
      settings.backgroundColor = saved.backgroundColor;
    }
    if (isHexColor(saved.revealTextColor)) {
      settings.revealTextColor = saved.revealTextColor;
    }
    if (
      Array.isArray(saved.colors) &&
      saved.colors.length === defaults.colors.length &&
      saved.colors.every(isHexColor)
    ) {
      settings.colors = [...saved.colors];
    }

  } catch (error) {
    console.warn("Saved settings could not be read:", error);
  }

  return settings;
}

export function createDebugPanel({ settings, defaults, onChange }) {
  const panel = document.querySelector("#debug-panel");
  const form = document.querySelector("#debug-form");
  const objectCountOutput = document.querySelector("#debug-object-count");
  const fpsOutput = document.querySelector("#debug-fps");
  const cameraMount = document.querySelector("#debug-camera-mount");
  const diagnostics = document.querySelector(".debug-diagnostics");
  const inputByKey = new Map();
  const rangeByKey = new Map();
  const savedPalettes = loadPaletteLibrary(settings.colors.length);
  const sectionMountByKey = new Map();
  const fpsSamples = [];
  let fpsSampleTotal = 0;

  for (const section of CONTROL_SECTIONS) {
    const details = document.createElement("details");
    details.className = "debug-section";
    details.open = section.open;

    const summary = document.createElement("summary");
    summary.textContent = section.label;

    const body = document.createElement("div");
    body.className = "debug-section__body";

    if (section.description) {
      const description = document.createElement("p");
      description.className = "debug-section__description";
      description.textContent = section.description;
      body.append(description);
    }

    details.append(summary, body);
    form.append(details);
    sectionMountByKey.set(section.key, body);
  }

  for (const control of BOOLEAN_CONTROLS) {
    const field = document.createElement("label");
    field.className = "debug-toggle";

    const label = document.createElement("span");
    label.textContent = control.label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = control.key;
    input.checked = settings[control.key];
    input.addEventListener("change", () => {
      settings[control.key] = input.checked;
      persistSettings(settings);
      onChange(control.key);
    });

    inputByKey.set(control.key, input);
    field.append(label, input);
    sectionMountByKey.get(control.section).append(field);
  }

  for (const control of NUMBER_CONTROLS) {
    const field = document.createElement("label");
    field.className = "debug-field";

    const label = document.createElement("span");
    label.textContent = control.label;

    const input = document.createElement("input");
    input.type = "number";
    input.name = control.key;
    input.setAttribute("aria-label", `${control.label} exact value`);
    if (Number.isFinite(control.min)) input.min = String(control.min);
    if (Number.isFinite(control.max)) input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(settings[control.key]);

    const controls = document.createElement("span");
    controls.className = "debug-number-control";
    const sliderMinimum = control.sliderMin ?? control.min;
    const sliderMaximum = control.sliderMax ?? control.max;
    const hasSlider =
      Number.isFinite(sliderMinimum) && Number.isFinite(sliderMaximum);
    let rangeInput = null;
    let pendingValue = settings[control.key];
    let updateFrame = null;

    const syncInputs = (value) => {
      input.value = String(value);
      if (rangeInput) syncRangeInput(rangeInput, value);
    };

    const applyValue = (value, save) => {
      const normalized = normalizeNumber(control, value);
      pendingValue = normalized;
      syncInputs(normalized);

      if (settings[control.key] !== normalized) {
        settings[control.key] = normalized;
        // `save` is true only when the value is committed — the slider let go,
        // or the number typed. Listeners that need to do something expensive
        // (rebuilding the whole painting) can wait for that instead of firing
        // on every frame of a drag.
        onChange(control.key, save);
      }
      if (save) persistSettings(settings);
    };

    const scheduleValue = (value) => {
      pendingValue = normalizeNumber(control, value);
      syncInputs(pendingValue);
      if (updateFrame !== null) return;

      updateFrame = requestAnimationFrame(() => {
        updateFrame = null;
        applyValue(pendingValue, false);
      });
    };

    const commitValue = (value) => {
      if (updateFrame !== null) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }
      applyValue(value, true);
    };

    if (hasSlider) {
      rangeInput = document.createElement("input");
      rangeInput.type = "range";
      rangeInput.min = String(sliderMinimum);
      rangeInput.max = String(sliderMaximum);
      rangeInput.step = String(control.step);
      rangeInput.setAttribute("aria-label", `${control.label} slider`);
      syncRangeInput(rangeInput, settings[control.key]);
      rangeInput.addEventListener("input", () => {
        scheduleValue(Number(rangeInput.value));
      });
      rangeInput.addEventListener("change", () => {
        commitValue(Number(rangeInput.value));
      });
      rangeByKey.set(control.key, rangeInput);
      controls.append(rangeInput);
    }

    input.addEventListener("input", () => {
      if (input.value.trim() === "") return;
      const value = Number(input.value);
      if (Number.isFinite(value)) scheduleValue(value);
    });
    input.addEventListener("change", () => {
      if (input.value.trim() === "" || !Number.isFinite(Number(input.value))) {
        syncInputs(settings[control.key]);
        return;
      }
      commitValue(Number(input.value));
    });

    inputByKey.set(control.key, input);
    controls.append(input);
    field.append(label, controls);
    sectionMountByKey.get(control.section).append(field);
  }

  // ------------------------------------------------------------- readouts
  // Output-only rows. Rendered once; updated through updateReadout/
  // updateChannels, both of which no-op while the panel is hidden.
  const readoutCellByKey = new Map();

  for (const group of READOUT_GROUPS) {
    const list = document.createElement("dl");
    list.className = "debug-readout";
    for (const row of group.rows) {
      const term = document.createElement("dt");
      term.textContent = row;
      const value = document.createElement("dd");
      value.textContent = "—";
      list.append(term, value);
      readoutCellByKey.set(`${group.key}:${row}`, value);
    }
    sectionMountByKey.get(group.section).prepend(list);
  }

  const channelBarByKey = new Map();
  const channelValueByKey = new Map();
  const channelDetailByKey = new Map();
  const discoveryMount = sectionMountByKey.get("discovery");

  const channelList = document.createElement("div");
  channelList.className = "debug-channels";
  for (const [key, label] of CHANNELS) {
    const row = document.createElement("div");
    row.className = "debug-channel";

    const head = document.createElement("div");
    head.className = "debug-channel__head";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("strong");
    value.textContent = "0%";
    head.append(name, value);

    const track = document.createElement("div");
    track.className = "debug-channel__track";
    const bar = document.createElement("div");
    bar.className = "debug-channel__bar";
    track.append(bar);

    const detail = document.createElement("small");
    detail.className = "debug-channel__detail";

    row.append(head, track, detail);
    channelList.append(row);
    channelBarByKey.set(key, bar);
    channelValueByKey.set(key, value);
    channelDetailByKey.set(key, detail);
  }
  discoveryMount.append(channelList);

  const colorSection = document.createElement("fieldset");
  colorSection.className = "debug-colors";
  const legend = document.createElement("legend");
  legend.textContent = "Colors";
  colorSection.append(legend);

  const palette = document.createElement("div");
  palette.className = "debug-palette";
  const colorInputs = settings.colors.map((color, index) => {
    const label = document.createElement("label");
    label.title = `Palette color ${index + 1}`;
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.setAttribute("aria-label", `Palette color ${index + 1}`);
    input.addEventListener("input", () => {
      settings.colors[index] = input.value;
      persistSettings(settings);
      onChange("colors");
    });
    label.append(input);
    palette.append(label);
    return input;
  });
  colorSection.append(palette);

  const paletteLibrary = document.createElement("div");
  paletteLibrary.className = "debug-palette-library";

  const paletteName = document.createElement("input");
  paletteName.type = "text";
  paletteName.placeholder = "Palette name";
  paletteName.maxLength = 48;
  paletteName.setAttribute("aria-label", "Palette name");

  const savePaletteButton = document.createElement("button");
  savePaletteButton.type = "button";
  savePaletteButton.textContent = "Save";

  const paletteSelect = document.createElement("select");
  paletteSelect.setAttribute("aria-label", "Saved color palettes");

  const loadPaletteButton = document.createElement("button");
  loadPaletteButton.type = "button";
  loadPaletteButton.textContent = "Load";

  const deletePaletteButton = document.createElement("button");
  deletePaletteButton.type = "button";
  deletePaletteButton.textContent = "Delete";

  const paletteStatus = document.createElement("small");
  paletteStatus.className = "debug-palette-library__status";
  paletteStatus.setAttribute("aria-live", "polite");

  const saveRow = document.createElement("div");
  saveRow.className = "debug-palette-library__row";
  saveRow.append(paletteName, savePaletteButton);

  const loadRow = document.createElement("div");
  loadRow.className = "debug-palette-library__row";
  loadRow.append(paletteSelect, loadPaletteButton, deletePaletteButton);

  paletteLibrary.append(saveRow, loadRow, paletteStatus);
  colorSection.append(paletteLibrary);

  const backgroundField = document.createElement("label");
  backgroundField.className = "debug-field debug-field--color";
  const backgroundLabel = document.createElement("span");
  backgroundLabel.textContent = "Background";
  const backgroundInput = document.createElement("input");
  backgroundInput.type = "color";
  backgroundInput.name = "backgroundColor";
  backgroundInput.value = settings.backgroundColor;
  backgroundInput.addEventListener("input", () => {
    settings.backgroundColor = backgroundInput.value;
    persistSettings(settings);
    onChange("backgroundColor");
  });
  backgroundField.append(backgroundLabel, backgroundInput);

  const revealTextField = document.createElement("label");
  revealTextField.className = "debug-field debug-field--color";
  const revealTextLabel = document.createElement("span");
  revealTextLabel.textContent = "Sentence (negative)";
  const revealTextInput = document.createElement("input");
  revealTextInput.type = "color";
  revealTextInput.name = "revealTextColor";
  revealTextInput.value = settings.revealTextColor;
  revealTextInput.addEventListener("input", () => {
    settings.revealTextColor = revealTextInput.value;
    persistSettings(settings);
    onChange("revealTextColor");
  });
  revealTextField.append(revealTextLabel, revealTextInput);

  sectionMountByKey.get("palette").append(backgroundField, revealTextField, colorSection);

  const refreshPaletteOptions = (preferredName = "") => {
    const names = Object.keys(savedPalettes).sort((a, b) =>
      a.localeCompare(b),
    );
    paletteSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      names.length > 0 ? "Choose a saved palette" : "No saved palettes";
    paletteSelect.append(placeholder);

    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      paletteSelect.append(option);
    }

    paletteSelect.value = savedPalettes[preferredName] ? preferredName : "";
  };

  const syncPaletteInputs = () => {
    settings.colors.forEach((color, index) => {
      colorInputs[index].value = color;
    });
    backgroundInput.value = settings.backgroundColor;
    revealTextInput.value = settings.revealTextColor;
  };

  savePaletteButton.addEventListener("click", () => {
    const name = paletteName.value.trim();
    if (!name) {
      paletteStatus.textContent = "Enter a name before saving.";
      paletteName.focus();
      return;
    }

    savedPalettes[name] = {
      colors: [...settings.colors],
      backgroundColor: settings.backgroundColor,
    };
    persistPaletteLibrary(savedPalettes);
    refreshPaletteOptions(name);
    paletteName.value = name;
    paletteStatus.textContent = `Saved “${name}”.`;
  });

  loadPaletteButton.addEventListener("click", () => {
    const name = paletteSelect.value;
    const savedPalette = savedPalettes[name];
    if (!savedPalette) {
      paletteStatus.textContent = "Choose a palette to load.";
      return;
    }

    settings.colors = [...savedPalette.colors];
    settings.backgroundColor = savedPalette.backgroundColor;
    syncPaletteInputs();
    persistSettings(settings);
    onChange("colors");
    paletteName.value = name;
    paletteStatus.textContent = `Loaded “${name}”.`;
  });

  deletePaletteButton.addEventListener("click", () => {
    const name = paletteSelect.value;
    if (!savedPalettes[name]) {
      paletteStatus.textContent = "Choose a palette to delete.";
      return;
    }

    delete savedPalettes[name];
    persistPaletteLibrary(savedPalettes);
    refreshPaletteOptions();
    paletteStatus.textContent = `Deleted “${name}”.`;
  });

  refreshPaletteOptions();

  // localStorage does not travel from a laptop to the installation machine,
  // and the engagement thresholds can only be set in front of the real camera.
  const transferRow = document.createElement("div");
  transferRow.className = "debug-palette-library__row";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export settings";
  exportButton.addEventListener("click", async () => {
    const json = JSON.stringify(settings, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      paletteStatus.textContent = "Settings copied to the clipboard.";
    } catch {
      console.log(json);
      paletteStatus.textContent = "Clipboard blocked — settings logged to the console.";
    }
  });

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "Import settings";
  importButton.addEventListener("click", () => {
    const raw = window.prompt("Paste exported settings JSON");
    if (!raw) return;
    try {
      const incoming = JSON.parse(raw);
      if (!incoming || typeof incoming !== "object") throw new Error("not an object");
      applyIncomingSettings(incoming);
      paletteStatus.textContent = "Settings imported.";
    } catch (error) {
      paletteStatus.textContent = "That did not parse as settings JSON.";
      console.warn("Settings import failed:", error);
    }
  });

  transferRow.append(exportButton, importButton);
  paletteLibrary.append(transferRow);

  function applyIncomingSettings(incoming) {
    for (const control of BOOLEAN_CONTROLS) {
      if (typeof incoming[control.key] === "boolean") settings[control.key] = incoming[control.key];
    }
    for (const control of NUMBER_CONTROLS) {
      const value = Number(incoming[control.key]);
      if (Number.isFinite(value)) settings[control.key] = normalizeNumber(control, value);
    }
    if (isHexColor(incoming.backgroundColor)) settings.backgroundColor = incoming.backgroundColor;
    if (
      Array.isArray(incoming.colors) &&
      incoming.colors.length === settings.colors.length &&
      incoming.colors.every(isHexColor)
    ) {
      settings.colors = [...incoming.colors];
    }
    syncAllInputs();
    persistSettings(settings);
    onChange("all");
  }

  function syncAllInputs() {
    for (const control of BOOLEAN_CONTROLS) {
      inputByKey.get(control.key).checked = settings[control.key];
    }
    for (const control of NUMBER_CONTROLS) {
      inputByKey.get(control.key).value = String(settings[control.key]);
      const rangeInput = rangeByKey.get(control.key);
      if (rangeInput) syncRangeInput(rangeInput, settings[control.key]);
    }
    syncPaletteInputs();
  }

  const resetButton = document.querySelector("#debug-reset");
  resetButton.addEventListener("click", () => {
    Object.assign(settings, cloneSettings(defaults));
    for (const control of BOOLEAN_CONTROLS) {
      inputByKey.get(control.key).checked = settings[control.key];
    }
    for (const control of NUMBER_CONTROLS) {
      inputByKey.get(control.key).value = String(settings[control.key]);
      const rangeInput = rangeByKey.get(control.key);
      if (rangeInput) syncRangeInput(rangeInput, settings[control.key]);
    }
    syncPaletteInputs();
    persistSettings(settings);
    onChange("all");
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLButtonElement;

    if (event.code === "Space" && !isEditing) {
      event.preventDefault();
      panel.hidden = !panel.hidden;
    } else if (event.code === "Escape" && !panel.hidden) {
      panel.hidden = true;
    }
  });

  return {
    get hidden() {
      return panel.hidden;
    },
    updateReadout(groupKey, values) {
      if (panel.hidden) return;
      for (const [row, value] of Object.entries(values)) {
        const cell = readoutCellByKey.get(`${groupKey}:${row}`);
        if (cell) cell.textContent = value === undefined || value === null ? "—" : String(value);
      }
    },
    updateChannels(report) {
      if (panel.hidden || !report) return;
      const percent = (v) => `${Math.round(v * 100)}%`;

      for (const [key] of CHANNELS) {
        const evidence = report.evidence[key] ?? 0;
        channelValueByKey.get(key).textContent = percent(evidence);
        channelBarByKey.get(key).style.width = `${Math.round(evidence * 100)}%`;
        channelDetailByKey.get(key).textContent = report.detail?.[key] ?? "";
      }

      // Said in words, because a number on its own does not explain itself.
      // This is the line that names WHICH channels are carrying the score.
      const strong = Object.entries(report.evidence)
        .filter(([, e]) => e > 0.15)
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => CHANNELS.find(([key]) => key === c)?.[1] ?? c);
      const why = report.discovered
        ? `worked it out — ${strong.join(" and ")}`
        : strong.length
          ? strong.join(" + ")
          : "nothing yet out of the ordinary";

      const cal = report.calibration;
      this.updateReadout("discovery", {
        level: report.level,
        score: `${percent(report.score)} · peak ${percent(report.peak)}`,
        why,
        "blinks seen": report.blinks,
        "their rate": report.baseline.known
          ? `every ${(report.baseline.ibi / 1000).toFixed(1)}s · ${(60000 / report.baseline.ibi).toFixed(0)}/min`
          : `assuming ${(report.baseline.ibi / 1000).toFixed(1)}s — ${report.baseline.samples} samples`,
        run: report.rapid
          ? `${report.rapid.blinks} blinks · ${report.rapid.run} gap(s) under ${(report.rapid.ceiling / 1000).toFixed(2)}s`
          : "none",
        cadence:
          report.rapid && report.rapid.strength !== undefined
            ? `every ${(report.rapid.mean / 1000).toFixed(2)}s · CV ${report.rapid.cv.toFixed(2)}`
            : "—",
        calibration: cal.settled ? "levels trusted" : cal.known ? "settling" : "calibrating",
      });

      // eyeBlink does not rest at zero for every face. This is where that
      // shows, and the first place to look if somebody is being misjudged.
      this.updateReadout("blink", {
        "their open": `L ${cal.rest.left.toFixed(2)}  R ${cal.rest.right.toFixed(2)}`,
        "their shut": cal.known
          ? `L ${cal.shut.left.toFixed(2)}  R ${cal.shut.right.toFixed(2)}`
          : "not seen a blink yet",
      });
    },
    attachCamera(video) {
      video.style.display = "block";
      video.className = "debug-camera";
      cameraMount.replaceChildren(video);
    },
    updateStats(objectCount, framesPerSecond) {
      objectCountOutput.textContent = objectCount.toLocaleString();
      if (Number.isFinite(framesPerSecond) && framesPerSecond > 0) {
        fpsSamples.push(framesPerSecond);
        fpsSampleTotal += framesPerSecond;

        if (fpsSamples.length > FPS_SAMPLE_WINDOW) {
          fpsSampleTotal -= fpsSamples.shift();
        }

        fpsOutput.textContent = Math.round(
          fpsSampleTotal / fpsSamples.length,
        ).toString();
      }
    },
  };
}

function persistSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Settings could not be saved:", error);
  }
}

function loadPaletteLibrary(expectedColorCount) {
  try {
    const saved = JSON.parse(localStorage.getItem(PALETTE_STORAGE_KEY));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};

    const palettes = Object.fromEntries(
      Object.entries(saved).filter(([, palette]) =>
        isValidPalette(palette, expectedColorCount),
      ),
    );

    return palettes;
  } catch (error) {
    console.warn("Saved color palettes could not be read:", error);
    return {};
  }
}

function persistPaletteLibrary(palettes) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palettes));
  } catch (error) {
    console.warn("Color palettes could not be saved:", error);
  }
}

function isValidPalette(palette, expectedColorCount) {
  return (
    palette &&
    typeof palette === "object" &&
    Array.isArray(palette.colors) &&
    palette.colors.length === expectedColorCount &&
    palette.colors.every(isHexColor) &&
    isHexColor(palette.backgroundColor)
  );
}

function cloneSettings(settings) {
  return { ...settings, colors: [...settings.colors] };
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function normalizeNumber(control, value) {
  const minimum = Number.isFinite(control.min) ? control.min : -Infinity;
  const maximum = Number.isFinite(control.max) ? control.max : Infinity;
  const clamped = clamp(value, minimum, maximum);
  return control.step >= 1 ? Math.round(clamped) : clamped;
}

function syncRangeInput(input, value) {
  input.value = String(clamp(value, Number(input.min), Number(input.max)));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
