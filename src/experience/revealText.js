/**
 * The discovery sentences, cut into the painting as negatives.
 *
 * Shown when the determiner is certain the participant has worked out that
 * blinking does something. The negative is `mix-blend-mode: difference` in
 * reveal.css; this module owns the body class, the colour the blend is
 * computed from, the wording, and the type size.
 */

/**
 * THE PHRASES. Edit, reorder, add or remove freely — one string per screen.
 * Each showing takes the next one and wraps around at the end, so a
 * participant who keeps earning the sentence gets a different one each time.
 * Length is not a constraint: fit() measures the type to the screen.
 */
export const PHRASES = [
  "Can we still be seen when we can't see, ourselves?",
  "What else are we interacting with, unknowingly?",
  "Who acts, can't see. Who sees, can't act. The system binds.",
];

const MAX_WIDTH_FRACTION = 0.155; // of viewport width, as a starting guess
const MAX_HEIGHT_FRACTION = 0.34; // of viewport height
const SHRINK = 0.97;
const MAX_STEPS = 80;

export function createRevealText({ settings }) {
  const element = document.querySelector("#reveal-text");
  const span = element.querySelector("span");
  let shown = false;
  let resizeTimer = 0;
  let phraseIndex = 0;

  const applyColor = () => {
    document.documentElement.style.setProperty("--reveal-text-color", settings.revealTextColor);
  };

  /**
   * Grow the type until it is about to overflow, then stop.
   *
   * A fixed font-size cannot do this: the number of lines depends on the
   * wording and the aspect ratio, and one line too many clips the sentence.
   * Measuring runs only when the sentence appears or the window changes — never
   * per frame — so it costs nothing during the piece.
   */
  const fit = () => {
    // Layout exists even at opacity 0, so this works while hidden.
    let size = Math.min(
      window.innerWidth * MAX_WIDTH_FRACTION,
      window.innerHeight * MAX_HEIGHT_FRACTION,
    );

    for (let step = 0; step < MAX_STEPS; step += 1) {
      element.style.fontSize = `${size}px`;
      const fitsHeight = span.scrollHeight <= element.clientHeight;
      const fitsWidth = span.scrollWidth <= element.clientWidth + 1;
      if (fitsHeight && fitsWidth) return;
      size *= SHRINK;
    }
  };

  const setText = (text) => {
    span.textContent = text;
    fit();
  };

  applyColor();
  // The markup carries a phrase so the page is never empty mid-load; the array
  // is the source of truth from here on.
  setText(PHRASES[0]);

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(fit, 200);
  });

  return {
    show() {
      if (shown) return;
      shown = true;
      applyColor();
      setText(PHRASES[phraseIndex % PHRASES.length]);
      phraseIndex = (phraseIndex + 1) % PHRASES.length;
      document.body.classList.add("discovered");
    },
    hide() {
      if (!shown) return;
      shown = false;
      document.body.classList.remove("discovered");
    },
    setText,
    applyColor,
    fit,
    get shown() { return shown; },
  };
}
