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
it can be true in two of the three.

## The two reveals

Both are single compositor operations declared in `src/styles/reveal.css`. No
pixels are read back, nothing is redrawn, and the painting loop never learns
either happened — so they cost the same at 5,000 marks or 50,000.

**The blink inverts the screen.** A white plane in `mix-blend-mode: difference`
is an exact inversion: `|backdrop − 255|` is `255 − backdrop`, per channel. It is
preferred over `filter: invert()` on the canvas element, which on some drivers
pulls a frequently-redrawn canvas out of accelerated compositing. The plane sits
*above* the sentence, so a blink inverts that too — everything inverts.

**The sentence is dismissed by a blink** — on the eyes *closing*, so it is
already gone when they can see again. `lingerTimerEnabled` ("Sentence lingers
timer" in the panel) decides whether `lingerMs` also clears it: on, whichever
comes first; off, only a blink will.

**The sentence is a negative cut into the painting**, not a panel laid over it:
`difference` again, so the letters read as `revealTextColor` over the dark ground
and flip to its complement wherever a pale mark passes underneath, and the
painting keeps moving through the type. Its size is measured rather than
guessed — `revealText.js` grows the type until it is about to overflow, once on
show and on resize, never per frame — so the sentence fills the screen without
clipping whatever the wording or the display. Every line is flush to both edges
(`text-align-last: justify` with `text-justify: inter-character`, so a
single-word last line can stretch on letter gaps and still reach the right
edge; where that is unsupported the last line falls back to natural width).

**The sentence is a moment, not an ending.** When the determiner is certain it
shows for `lingerMs` (5s default) and then hands the participant back to being
drawn and tracked. The determiner is re-armed at that moment, so somebody who
goes on blinking deliberately can summon it again, and again, for as long as they
stay — the Session readout counts the triggers.

**Walking away clears everything immediately.** No grace window and no resuming:
the sentence goes with them the instant the engagement gate drops, the determiner
is reset, and whoever is next starts from nothing. The same happens the moment
identity tracking is confident a different person has walked up.

Re-arming keeps the person. `discovery.rearm()` clears the finding, the evidence
behind it and the rhythm buffers — so the next sentence has to be earned by a
fresh run rather than paid for by the one just performed — while keeping the eye
normalizer and the baseline of what their ordinary blink looks like. A full
`discovery.reset()` is reserved for somebody else walking up, because the
normalizer's idea of an open eye belongs to the face that taught it.

That distinction is load-bearing: `calibrated()` needs two blinks and four
seconds, and without it the *hold* and *squint* channels stay silent. Resetting
between triggers would make the same person re-teach the determiner their face
every time.

> `rearm()` is the **one** local addition to `src/perception/blink/`, marked in
> place in `discovery.js`. Everything else in that folder is byte-identical to
> repo B, which is why `parity-check` and `discovery-sim` still hold.

### Calibration, and the thirty seconds you actually get

`hold` and `squint` read absolute lid levels, so they stay silent until the
normalizer knows this face. That gate is **two closures plus three seconds**, not
four blinks — and it is the *closures* that bind, because somebody looking at a
painting blinks slowly.

| blinks/min | before hold & squint can speak |
|---:|---:|
| 6 | 11.4s |
| 15 | 5.2s |
| 30 | 3.4s |

Upstream asked for three closures, which at six blinks a minute is **21 seconds** —
most of a gallery visit, spent waiting. It bought nothing: `shut` is shrunk toward
the canonical 1.0 with a prior of 6 and keeps refining over a rolling window of
the last 24 peaks, so the settled estimate is identical whether it started
believing after one closure or three. `discoveryMinPeaks` only decides when it
starts, never where it ends up.

**Nothing is gated on calibration except those two channels.** `rapid` is
interval-based and works from the first two blinks, so a visitor who only ever
blinks fast is read correctly from the start.

Both levels track continuously for as long as somebody is there: the resting
level from a rolling 10s window, `shut` from the last 24 closures, both
recomputed four times a second. A person who leans in or changes the light on
their face is followed, not stuck with a first impression.

Deliberate tricks are kept out of *discovery's* baseline — what counts as their
normal blink only learns from closures with at least 1.2s of clear air before
them, intervals stop learning the moment a run is in progress, and everything
freezes once the score passes `suspect`, so a burst cannot redefine the normal it
is being measured against. The **normalizer** has no such notion, by design: a
squint that never crosses its peak threshold is not recorded as a closure at all,
and anything that does is one of 24 in a median.

### How much proof it asks for

Every gain is 1.0, which makes each weight readable as **the score one clear
performance of that signal earns**. At or above the bar, that signal alone is
enough:

| signal | worth | alone? |
|---|---:|---|
| eyes held shut (1s) | 0.88 | yes |
| rapid blinking | 0.85 | yes |
| one eye | 0.82 | yes |
| a held squint | 0.78 | yes |
| blinks unlike their own | 0.55 | corroboration only |

Upstream, only rapid blinking could do it alone: a two-second eye-hold reached
0.64 and stopped, and squint's ceiling of 0.65 put it permanently out of reach.
Requiring two different kinds of trickery was an assumption, not a finding —
somebody who works it out may only ever do the one thing.

A held squint was worse than under-weighted: it scored **nothing at all**.
`closeEnter` (0.5) sat inside `squintBand` (0.42–0.88), so a squint at 0.58 was
recorded as the eyes having CLOSED, which switches off the parked-squint
detector — and the closure then fell through every branch, being too long for a
blink, too shallow for a hold and too abrupt for a slow onset. The two bands are
now separated: a closure is the eyes actually going shut (0.9), and anything
parked below 0.86 for long enough is a squint.

**Second time onward** the bar drops from 0.70 to `discoveryRetrigger` (0.55):
they demonstrated it a moment ago and are plainly doing it again on purpose, and
holding them to the same standard twice reads as the machine having forgotten.
0.55 is measured, not chosen — across 98 simulated ordinary visitor-minutes the
highest anyone reached without trying anything was 0.51, and 0.55 is the lowest
bar that never fired on them (0.50 fires on 1%, 0.45 on 2%, 0.40 on 3%).

`scripts/pipeline-check.js` holds both halves of the bargain: every signal alone
is enough, and nobody merely blinking is ever accused.

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
