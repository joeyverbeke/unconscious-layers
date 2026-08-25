/**
 * The discovery sentence, across the screen.
 *
 * Shown when the determiner is certain the participant has worked out that
 * blinking does something, and left up until the piece forgets them.
 */
export function createRevealText({ settings }) {
  const element = document.querySelector("#reveal-text");
  let shown = false;

  const applyStacking = () =>
    document.body.classList.toggle("text-above-reveal", !!settings.textAboveReveal);
  applyStacking();

  return {
    show() {
      if (shown) return;
      shown = true;
      applyStacking();
      document.body.classList.add("discovered");
    },
    hide() {
      if (!shown) return;
      shown = false;
      document.body.classList.remove("discovered");
    },
    setText(text) { element.textContent = text; },
    applyStacking,
    get shown() { return shown; },
  };
}
