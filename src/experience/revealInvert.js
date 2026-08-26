/**
 * The blink reveal: everything on screen inverts for exactly as long as their
 * eyes are shut.
 *
 * All of the work is one compositor operation declared in reveal.css — a white
 * plane in `difference` blend. Nothing is read back, nothing is redrawn, and
 * the painting loop never learns this happened, so the cost does not grow with
 * the mark count. This module only owns the body class.
 */
export function createRevealInvert({ settings }) {
  let shown = false;

  return {
    set(next) {
      const wanted = next && settings.blinkInvertEnabled !== false;
      if (wanted === shown) return;
      shown = wanted;
      document.body.classList.toggle("eyes-closed", shown);
    },
    get shown() { return shown; },
  };
}
