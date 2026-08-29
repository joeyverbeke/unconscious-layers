// Development-only URL flags. Production ignores everything here.
const params = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;

const number = (name) => {
  const raw = params?.get(name);
  return raw === null || raw === undefined ? Number.NaN : Number(raw);
};
const on = (name) => params?.get(name) === "1";

// Not DEV-gated: a stale saved blob on the installation machine silently
// overrides a deployed change, and the panel is not always reachable there.
const alwaysParams = new URLSearchParams(window.location.search);

// Operational rather than developmental, so NOT gated on DEV: these are the
// levers the installation actually needs on site, and a built bundle is what
// runs there. `tier` pins the quality so the governor cannot step the work
// down mid-show, `delegate` A/Bs the FaceLandmarker backend, and `skipCamera`
// isolates the painting's frame cost from the vision pipeline's when working
// out which of the two a slow machine is struggling with.
const always = (name) => alwaysParams.get(name);

export const flags = Object.freeze({
  resetSettings: always("resetSettings") === "1",
  testSeed: number("testSeed"),
  freezePainting: on("freezePainting"),
  skipCamera: always("skipCamera") === "1",
  eyesClosed: on("eyesClosed"),
  forceDiscovery: on("forceDiscovery"),
  state: params?.get("state") ?? null,
  tier: always("tier"),
  delegate: always("delegate"),
});
