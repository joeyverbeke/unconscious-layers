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

export const flags = Object.freeze({
  resetSettings: alwaysParams.get("resetSettings") === "1",
  testSeed: number("testSeed"),
  freezePainting: on("freezePainting"),
  skipCamera: on("skipCamera"),
  eyesClosed: on("eyesClosed"),
  forceDiscovery: on("forceDiscovery"),
  state: params?.get("state") ?? null,
  tier: params?.get("tier") ?? null,
  delegate: params?.get("delegate") ?? null,
});
