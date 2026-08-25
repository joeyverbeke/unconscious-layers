/**
 * The eyes-closed reveal: a full-bleed opaque image above everything.
 *
 * Instant on, instant off, no transition — a fade would read as an effect,
 * rather than as something that was simply there while your eyes were shut.
 * The CSS lives in styles/reveal.css; this only owns the body class.
 */
export function createRevealImage({ settings }) {
  const image = document.querySelector("#reveal-image");
  let shown = false;

  if (settings.revealImageEnabled === false) image.hidden = true;

  return {
    set(next) {
      if (next === shown) return;
      shown = next && settings.revealImageEnabled !== false;
      document.body.classList.toggle("eyes-closed", shown);
    },
    get shown() { return shown; },
    setSource(src) { image.src = src; },
  };
}
