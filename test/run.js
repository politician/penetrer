'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!match) {
  console.error('FAIL: no <script id="core"> block found in index.html');
  process.exit(1);
}

const EXPORTS = [
  'DESIGN_W', 'DESIGN_H', 'CELLS_TALL', 'FILL_FRACTION',
  'DURATION_1X', 'MAX_DELTA', 'HOT_SECONDS',
  'advance',
];
// Names not yet implemented come back undefined rather than crashing the
// harness, so the red phase of each task fails as a test rather than a stack trace.
const fields = EXPORTS
  .map(n => n + ': typeof ' + n + ' === "undefined" ? undefined : ' + n)
  .join(',');
const core = new Function(match[1] + '\nreturn {' + fields + '};')();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function close(actual, expected, eps, msg) {
  assert(Math.abs(actual - expected) <= eps,
    (msg ? msg + ': ' : '') + 'expected ' + expected + ' got ' + actual);
}

test('advance moves progress forward proportionally to delta and speed', () => {
  close(core.advance(0, 0.1, 1), 0.1 / 300, 1e-12);
  close(core.advance(0, 0.05, 3), 0.05 * 3 / 300, 1e-12);
  close(core.advance(0.2, 0.05, 1), 0.2 + 0.05 / 300, 1e-12);
});

test('300s of 60fps frames at 1x completes exactly one traversal', () => {
  let p = 0;
  for (let i = 0; i < 300 * 60; i++) p = core.advance(p, 1 / 60, 1);
  close(p, 1, 1e-9);
});

test('3x completes a traversal in 100s and 5x in 60s', () => {
  let p3 = 0;
  for (let i = 0; i < 100 * 60; i++) p3 = core.advance(p3, 1 / 60, 3);
  close(p3, 1, 1e-9);
  let p5 = 0;
  for (let i = 0; i < 60 * 60; i++) p5 = core.advance(p5, 1 / 60, 5);
  close(p5, 1, 1e-9);
});

test('changing speed mid-traversal continues from current progress', () => {
  let p = 0;
  for (let i = 0; i < 150 * 60; i++) p = core.advance(p, 1 / 60, 1);
  close(p, 0.5, 1e-9, 'half the drawing at 1x');
  for (let i = 0; i < 50 * 60; i++) p = core.advance(p, 1 / 60, 3);
  close(p, 1, 1e-9, 'remaining half at 3x takes 50s');
});

// Review Focus 1: a backgrounded tab must resume, not fast-forward.
test('a huge frame delta is clamped to MAX_DELTA', () => {
  close(core.advance(0, 600, 1), core.advance(0, core.MAX_DELTA, 1), 1e-12);
  close(core.advance(0, 600, 5), core.MAX_DELTA * 5 / 300, 1e-12);
});

// Review Focus 2: progress must never run backwards.
test('zero and negative deltas leave progress unchanged', () => {
  close(core.advance(0.42, 0, 1), 0.42, 1e-12);
  close(core.advance(0.42, -10, 5), 0.42, 1e-12);
});

// --- tests go here ---

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
