// The experience state machine, driven headlessly through every lifecycle case
// the piece is specified to handle. No camera, no DOM.
import { createExperience, STATE } from '../src/experience/experienceState.js';

let failures = 0;
const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'}   ${label}${detail ? '  ' + detail : ''}`);
  if (!condition) failures += 1;
};

function harness(overrides = {}) {
  const settings = {
    lingerMs: 5000, swapCooldownMs: 400, eyesClosedWatchdogMs: 3000,
    textAboveReveal: false, ...overrides,
  };
  const handlers = new Map();
  const calls = { discoveryResets: 0, forgets: 0 };

  const perception = {
    on: (event, fn) => { const l = handlers.get(event) ?? []; l.push(fn); handlers.set(event, l); },
    handles: {
      discovery: { reset: () => { calls.discoveryResets += 1; } },
      participant: { forget: () => { calls.forgets += 1; } },
    },
  };
  const emit = (event, payload) => { for (const fn of handlers.get(event) ?? []) fn(payload); };

  const painting = { engaged: false, setEngaged(v) { this.engaged = v; } };
  const revealText = { shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, applyStacking() {} };
  const revealImage = { shown: false, set(v) { this.shown = v; } };

  const experience = createExperience({ settings, perception, painting, revealImage, revealText });
  return { experience, emit, painting, revealText, revealImage, calls, settings };
}

console.log('\nThe arc: idle -> engaged -> discovered -> back to engaged\n');
{
  const h = harness({ lingerMs: 5000 });
  ok('starts idle', h.experience.state === STATE.IDLE);

  h.emit('engagement', { engaged: true });
  ok('engaging draws the person', h.experience.state === STATE.ENGAGED && h.painting.engaged === true);

  h.emit('discovery', { report: {} });
  ok('discovery raises the sentence',
     h.experience.state === STATE.DISCOVERED && h.revealText.shown === true);

  h.experience.tick(performance.now() + 3000);
  ok('which stays for the configured time', h.revealText.shown === true);

  h.experience.tick(performance.now() + 6000);
  ok('then gives them back the painting, still present',
     h.experience.state === STATE.ENGAGED && h.revealText.shown === false && h.painting.engaged === true);
  h.experience.stop();
}

console.log('\nThey can earn it again, and again\n');
{
  const h = harness({ lingerMs: 5000 });
  h.emit('engagement', { engaged: true });

  for (let round = 1; round <= 3; round++) {
    h.emit('discovery', { report: {} });
    ok(`trigger ${round}: the sentence returns`,
       h.experience.state === STATE.DISCOVERED && h.revealText.shown === true);
    h.experience.tick(performance.now() + 6000);
    ok(`trigger ${round}: and comes back down`,
       h.experience.state === STATE.ENGAGED && h.revealText.shown === false);
  }
  ok('the determiner was re-armed once per sentence', h.calls.discoveryResets === 3);
  ok('three triggers were counted in one visit', h.experience.snapshot().triggerCount === 3);
  h.experience.stop();
}

console.log('\nWalking away clears it at once\n');
{
  const h = harness({ lingerMs: 60000 });
  h.emit('engagement', { engaged: true });
  h.emit('discovery', { report: {} });
  ok('the sentence is up', h.revealText.shown === true);

  h.emit('engagement', { engaged: false });
  ok('walking away removes it immediately, with no grace window',
     h.experience.state === STATE.IDLE && h.revealText.shown === false);
  ok('and everything of theirs is forgotten',
     h.calls.discoveryResets >= 1 && h.calls.forgets === 1);
  h.experience.stop();
}
{
  const h = harness({ lingerMs: 5000 });
  h.emit('engagement', { engaged: true });
  h.emit('discovery', { report: {} });
  h.emit('engagement', { engaged: false });
  h.emit('engagement', { engaged: true });
  ok('the next person starts from the painting, not the sentence',
     h.experience.state === STATE.ENGAGED && h.revealText.shown === false);
  ok('with no triggers carried over', h.experience.snapshot().triggerCount === 0);
  h.experience.stop();
}

console.log('\nSomebody else walks up\n');
{
  const h = harness({ lingerMs: 60000 });
  h.emit('engagement', { engaged: true });
  h.emit('discovery', { report: {} });
  ok('first person has the sentence', h.revealText.shown === true);

  h.emit('participant', { type: 'end', why: 'swapped' });
  ok('a swap clears the sentence at once',
     h.experience.state === STATE.IDLE && h.revealText.shown === false);
  ok('and clears their evidence', h.calls.discoveryResets >= 1);

  h.emit('engagement', { engaged: true });
  ok('the newcomer waits out the swap cooldown', h.experience.state === STATE.IDLE);
  h.experience.stop();
}
{
  const h = harness({ lingerMs: 5000, swapCooldownMs: 0 });
  h.emit('engagement', { engaged: true });
  h.emit('discovery', { report: {} });
  h.emit('participant', { type: 'end', why: 'swapped' });
  h.emit('engagement', { engaged: true });
  ok('with the cooldown elapsed the newcomer engages fresh, without the sentence',
     h.experience.state === STATE.ENGAGED && h.revealText.shown === false);
  h.experience.stop();
}

console.log('\nThe blink overlay is orthogonal to the state\n');
{
  const h = harness();
  h.emit('engagement', { engaged: true });
  h.emit('discovery', { report: {} });
  h.emit('blink', { closed: true });
  ok('a blink while the sentence is up shows both, and changes no state',
     h.experience.state === STATE.DISCOVERED && h.revealImage.shown === true && h.revealText.shown === true);

  h.emit('blink', { closed: false });
  ok('and it comes straight back down', h.revealImage.shown === false);
  h.experience.stop();
}
{
  const h = harness();
  h.emit('blink', { closed: true });
  ok('the reveal does not arm while idle',
     h.revealImage.shown === false && h.experience.eyesClosed === false);
  h.experience.stop();
}
{
  const h = harness();
  h.emit('engagement', { engaged: true });
  h.emit('blink', { closed: true });
  ok('eyes are closed while engaged', h.experience.eyesClosed === true);
  // Detector wedged: the watchdog is the belt to the detector's braces.
  h.experience.tick(performance.now() + 4000);
  ok('the watchdog takes a stuck image down', h.experience.eyesClosed === false && h.revealImage.shown === false);
  h.experience.stop();
}
{
  const h = harness();
  h.emit('engagement', { engaged: true });
  h.emit('blink', { closed: true });
  h.emit('engagement', { engaged: false });
  ok('leaving mid-blink takes the image down with it',
     h.experience.state === STATE.IDLE && h.revealImage.shown === false);
  h.experience.stop();
}

console.log('\nDiscovery cannot be spent on nobody\n');
{
  const h = harness();
  h.emit('discovery', { report: {} });
  ok('discovery while idle is ignored', h.experience.state === STATE.IDLE && h.revealText.shown === false);
  h.emit('engagement', { engaged: true });
  ok('and the person who then walks up is merely engaged', h.experience.state === STATE.ENGAGED);
  ok('their sentence is still theirs to earn', h.revealText.shown === false);
  h.experience.stop();
}

console.log(failures === 0 ? '\nall passed\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
