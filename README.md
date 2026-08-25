# Unconscious Layers

A generative painting that paints itself continuously. When somebody comes close
enough, their outline and their eyes and mouth are drawn on top of it — in marks
stolen out of the painting itself. When they blink, something happens. And all
the while the piece is working out whether they have realised that *they* are
what makes it happen.

Combines two exploration projects: the painting and person-tracking from
`9_painting-sketches/experiments/04-01-face-landmarks`, and the blink detection
and discovery determiner from `7_unconscious/public/lib/blink`.

## Running it

```bash
npm install
npm run dev          # http://localhost:5300
```

```bash
npm run check        # every headless test — no browser, no camera
```

`getUserMedia` needs a secure context, so open the piece on `http://localhost`
only — never over the LAN IP.

## The three states

| state | what is on screen |
|---|---|
| `idle` | the painting, alone |
| `engaged` | + their outline, eyes and mouth; the blink reveal is armed |
| `discovered` | + the sentence, for `lingerMs` |

`eyesClosed` is deliberately **not** a state — it is an orthogonal overlay, since
it can be true in two of the three. The full-bleed reveal image sits above the
sentence, so a blink hides it: the picture exists only inside the blink.

**The sentence is a moment, not an ending.** When the determiner is certain it
shows for `lingerMs` (5s default) and then hands the participant back to being
drawn and tracked. The determiner is re-armed at that moment, so somebody who
goes on blinking deliberately can summon it again, and again, for as long as they
stay — the Session readout counts the triggers.

**Walking away clears everything immediately.** No grace window and no resuming:
the sentence goes with them the instant the engagement gate drops, the determiner
is reset, and whoever is next starts from nothing. The same happens the moment
identity tracking is confident a different person has walked up.

Re-arming clears that person's blink calibration along with their evidence, which
only gates the *hold* and *squint* channels — `rapid` is interval-based and needs
no calibration, so a fresh burst of deliberate blinking re-fires on its own.

## Structure

```
src/
  perception/     one camera, one segmenter, one FaceLandmarker
    blink/        VERBATIM from 7_unconscious — do not edit in place
  painting/       the generative painting and the marks it lends out
  experience/     the state machine and the two reveals
  settings/       defaults, quality tiers, dev flags, debug panel
scripts/          the test suite (node only)
```

Two rules worth keeping:

- **`src/perception/blink/` is copied verbatim** — `detector.js`, `normalize.js`,
  `gates.js`, `discovery.js` carry a lot of tuning, and `parity-check.js` /
  `discovery-sim.js` assert they still behave as they did in the original. Change
  them there, not here.
- **The determiner is fed raw, ungated blendshape scores.** It runs its own
  normalizer; feeding it the already-normalized closure would normalize twice and
  silently ruin the two channels that read absolute levels.

## Tuning

`Space` opens the debug panel; `Escape` closes it. Everything persists to
localStorage, and **Export / Import settings** moves a whole tuning session
between machines — localStorage does not travel.

> **Saved settings beat the defaults in `src/settings/defaults.js`.** That is the
> whole point of the panel, but it means editing a default in code has no visible
> effect on a browser that has ever saved anything — and a hard reload will not
> help, because it clears the HTTP cache and not site data. Load once with
> `?resetSettings=1`, or press **Reset** in the panel. This applies to the
> installation machine too: a tuning session left in localStorage there will
> quietly override whatever you deploy.

**Sizes** in the panel are authored at a **1280×720 reference** and scaled to the
real canvas at the point of use, so the same numbers mean the same thing on a
laptop and on the installation machine.

**Counts are literal.** `objectCount` is the number of marks, full stop — it is
not scaled by canvas area, so what the panel says is what is on screen. The
trade is that mark *density* varies with window size during development; the
FIFO turnover period (`objectCount / primitivesPerSecond`) does not, and the
installation runs at the reference resolution where the question is moot.

**`enterFaceScale` cannot be guessed.** It depends on the lens and how far the
screen is from where people stand. `0.22` is a starting point, not a value — set
it in front of the real camera, watching the Engagement readout.

## Dev flags

| flag | effect |
|---|---|
| `?skipCamera=1` | painting only, no camera |
| `?freezePainting=1` | stop renewing marks |
| `?testSeed=N` | deterministic composition |
| `?state=discovered` | jump straight to a state |
| `?eyesClosed=1` | pin the reveal image up (bypasses the watchdog) |
| `?forceDiscovery=1` | fire discovery 3s after engaging |
| `?tier=low` | quality preset: `high` \| `medium` \| `low` |
| `?delegate=cpu` | force MediaPipe onto CPU |
| `?resetSettings=1` | discard saved settings and take the defaults from source |

## Notes for the installation machine

The piece was built against a Raspberry Pi 5 as the likely target, and **40,000
marks will not happen there**. Treat `low` as the real target and `high` as the
laptop preview. If the frame rate cannot hold the quality governor
steps down one tier, once — after an 8s warmup so building the pool and
compiling the models is not mistaken for a slow machine, and never when a tier
was named explicitly on the URL, since that is a decision rather than a guess.

The knobs that actually matter, in order: `objectCount` (linear in draw calls —
the whole ballgame), `rotatedSquares` (off removes a canvas transform
save-restore from a third of all marks), `primitivesPerSecond`,
`outlineRetargetHz`, `segmentationFps`, `maxTyphoonSize`.

The GPU delegate may silently fall back to CPU on small-SoC hardware; the code
does that automatically and reports which it got in the Blink readout. Camera
frame rate is the blink budget — a blink is 100–150ms, and many USB webcams
reach 30fps at 720p only in MJPEG. The readout shows what the camera actually
gave, not what was asked for.
