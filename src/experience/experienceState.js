export const STATE = {
  IDLE: "idle",             // the painting, alone
  ENGAGED: "engaged",       // outline + eyes + mouth; the blink reveal is armed
  DISCOVERED: "discovered", // as ENGAGED, plus the sentence, for lingerMs
};

/**
 * The only module that knows what the piece is. Perception knows nothing about
 * states; the painting knows nothing about discovery.
 *
 * The sentence is a MOMENT, not an ending. When the determiner is certain, the
 * sentence shows for `lingerMs` and then hands the participant back to being
 * drawn and tracked — and the determiner is re-armed, so somebody who goes on
 * blinking deliberately can summon it again, and again, for as long as they
 * stay. Walking away clears everything at once.
 *
 * `eyesClosed` is deliberately NOT a state. It can be true in both ENGAGED and
 * DISCOVERED, so modelling it as a state would give the product of two
 * machines. It is an orthogonal boolean rendered as an overlay.
 */
export function createExperience({ settings, perception, painting, revealInvert, revealText, flags = {} }) {
  const listeners = [];
  const { discovery, participant } = perception.handles;

  let state = STATE.IDLE;
  let enteredAt = now();
  let gateEngaged = false;
  let eyesClosed = false;
  let eyesClosedSince = 0;
  let discoveredAt = 0;
  let swapCooldownUntil = 0;
  let triggerCount = 0;

  function now() { return performance.now(); }

  function go(next) {
    if (next === state) return;
    const from = state;
    state = next;
    enteredAt = now();
    applyState(from);
    for (const handler of listeners) handler({ from, to: next, at: enteredAt });
  }

  // Every effect of being in a state, in one place, so the piece's behaviour is
  // written down exactly once.
  function applyState(from) {
    switch (state) {
      case STATE.IDLE:
        painting.setEngaged(false);
        revealText.hide();
        setEyesClosed(false);
        // They are gone. Nothing of theirs should greet the next person.
        forgetParticipant();
        break;

      case STATE.ENGAGED:
        painting.setEngaged(true);
        revealText.hide();
        // Coming back down from the sentence, re-arm the determiner so they can
        // earn it again. It fires once per armed cycle and stays latched, so
        // without this the sentence could never return while they stood there.
        if (from === STATE.DISCOVERED) discovery.reset();
        break;

      case STATE.DISCOVERED:
        painting.setEngaged(true);
        revealText.show();
        discoveredAt = now();
        triggerCount += 1;
        break;
    }
  }

  function forgetParticipant() {
    discovery.reset();
    participant.forget("left");
    triggerCount = 0;
  }

  function setEyesClosed(next) {
    const allowed = next && state !== STATE.IDLE;
    if (allowed === eyesClosed) return;
    eyesClosed = allowed;
    if (eyesClosed) eyesClosedSince = now();
    revealInvert.set(eyesClosed);
  }

  // ---- perception -> state -------------------------------------------------

  perception.on("engagement", ({ engaged }) => {
    gateEngaged = engaged;

    if (engaged) {
      // After a swap, ignore the incoming person for a beat so the previous
      // person's sentence is visibly gone before the next session starts.
      if (now() < swapCooldownUntil) return;
      if (state === STATE.IDLE) go(STATE.ENGAGED);
      return;
    }

    // Walking away takes the sentence with them, immediately — no grace, no
    // resuming. Whoever is next starts from nothing.
    go(STATE.IDLE);
  });

  perception.on("blink", ({ closed }) => {
    setEyesClosed(closed);

    // Blinking dismisses the sentence, and it goes on the eyes CLOSING rather
    // than opening — so it is already gone when they can see again, and the
    // question is answered by the way it leaves.
    if (closed && state === STATE.DISCOVERED) go(STATE.ENGAGED);
  });

  perception.on("discovery", () => {
    // Only somebody actually engaged can spend a determination. Guarded because
    // the determiner is fed from the camera, not from the engagement gate.
    if (state !== STATE.ENGAGED) return;
    go(STATE.DISCOVERED);
  });

  perception.on("participant", ({ type, why }) => {
    if (type !== "end" || why !== "swapped") return;
    swapCooldownUntil = now() + settings.swapCooldownMs;
    go(STATE.IDLE);
  });

  perception.on("error", ({ fatal }) => {
    if (fatal) go(STATE.IDLE);
  });

  // ---- timers --------------------------------------------------------------

  function tick(at = now()) {
    // The sentence is shown for lingerMs and then gives them back the painting.
    // With the timer off it stays until they blink it away, however long that
    // takes — blinking is always able to dismiss it either way.
    if (
      state === STATE.DISCOVERED &&
      settings.lingerTimerEnabled &&
      at - discoveredAt >= settings.lingerMs
    ) {
      go(STATE.ENGAGED);
    }

    // A stuck full-bleed image over an empty room is the worst failure this
    // piece has. The detector releases on its own when the face goes (see
    // pipeline-check), but a blink is 150ms and three seconds is not a blink.
    // ?eyesClosed=1 deliberately pins the image for inspection, so it opts out.
    if (!flags.eyesClosed && eyesClosed && at - eyesClosedSince > settings.eyesClosedWatchdogMs) {
      setEyesClosed(false);
    }
  }

  const timer = setInterval(() => tick(), 50);

  if (flags.state && Object.values(STATE).includes(flags.state)) go(flags.state);
  if (flags.eyesClosed) {
    if (state === STATE.IDLE) go(STATE.ENGAGED);
    setEyesClosed(true);
  }

  return {
    tick,
    on: (handler) => { listeners.push(handler); return () => listeners.splice(listeners.indexOf(handler), 1); },
    forceState: go,
    stop: () => clearInterval(timer),
    get state() { return state; },
    get eyesClosed() { return eyesClosed; },
    get timeInState() { return now() - enteredAt; },
    snapshot() {
      return {
        state,
        eyesClosed,
        gateEngaged,
        triggerCount,
        timeInState: now() - enteredAt,
        sentenceRemaining:
          state === STATE.DISCOVERED
            ? Math.max(0, settings.lingerMs - (now() - discoveredAt))
            : null,
      };
    },
  };
}
