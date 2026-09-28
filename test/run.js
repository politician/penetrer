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
  'arcPoints', 'OUTLINE', 'buildPath', 'pointAt',
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

test('arcPoints starts and ends exactly on the requested angles', () => {
  const pts = core.arcPoints(50, 24, 16, 90, 0);
  close(pts[0][0], 50, 1e-9, 'start x');
  close(pts[0][1], 8, 1e-9, 'start y');
  close(pts[pts.length - 1][0], 66, 1e-9, 'end x');
  close(pts[pts.length - 1][1], 24, 1e-9, 'end y');
  assert(pts.length > 20, 'a quarter of a radius-16 arc needs many points, got ' + pts.length);
});

test('arcPoints keeps every point on the circle', () => {
  for (const p of core.arcPoints(34, 108, 20, -36.87, -270)) {
    close(Math.hypot(p[0] - 34, p[1] - 108), 20, 1e-6);
  }
});

test('OUTLINE stays inside the design space', () => {
  for (const [x, y] of core.OUTLINE) {
    assert(x >= 0 && x <= core.DESIGN_W, 'x out of range: ' + x);
    assert(y >= 0 && y <= core.DESIGN_H, 'y out of range: ' + y);
  }
});

test('buildPath drops consecutive duplicate points', () => {
  const p = core.buildPath([[0, 0], [0, 0], [10, 0], [10, 0], [10, 10]]);
  assert(p.points.length === 3, 'expected 3 points, got ' + p.points.length);
});

test('buildPath drops a closing point equal to the first', () => {
  const p = core.buildPath([[0, 0], [10, 0], [10, 10], [0, 0]]);
  assert(p.points.length === 3, 'expected 3 points, got ' + p.points.length);
  close(p.totalLength, 10 + 10 + Math.hypot(10, 10), 1e-9);
});

test('totalLength equals the sum of every segment including the closing one', () => {
  const p = core.buildPath(core.OUTLINE);
  let sum = 0;
  for (let i = 0; i < p.points.length; i++) {
    const a = p.points[i], b = p.points[(i + 1) % p.points.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  close(p.totalLength, sum, 1e-9);
  assert(p.totalLength > 300 && p.totalLength < 380,
    'expected roughly 341 design units, got ' + p.totalLength);
});

test('the contour closes: pointAt(0) and pointAt(1) are the same point', () => {
  const p = core.buildPath(core.OUTLINE);
  const a = core.pointAt(p, 0), b = core.pointAt(p, 1);
  close(a[0], b[0], 1e-9, 'x');
  close(a[1], b[1], 1e-9, 'y');
});

test('pointAt advances monotonically with no jumps, including across the seam', () => {
  const p = core.buildPath(core.OUTLINE);
  const steps = 4000;
  const maxStep = (p.totalLength / steps) * 3;
  let prev = core.pointAt(p, 0);
  for (let i = 1; i <= steps; i++) {
    const cur = core.pointAt(p, i / steps);
    const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    assert(d <= maxStep, 'jump of ' + d + ' at t=' + (i / steps));
    prev = cur;
  }
});

test('pointAt wraps for t outside [0,1]', () => {
  const p = core.buildPath(core.OUTLINE);
  const a = core.pointAt(p, 0.25);
  const b = core.pointAt(p, 3.25);
  const c = core.pointAt(p, -0.75);
  close(a[0], b[0], 1e-9, 'positive wrap x');
  close(a[1], b[1], 1e-9, 'positive wrap y');
  close(a[0], c[0], 1e-9, 'negative wrap x');
  close(a[1], c[1], 1e-9, 'negative wrap y');
});

test('arc length is distributed evenly: halfway around is halfway along', () => {
  const p = core.buildPath(core.OUTLINE);
  let walked = 0, prev = core.pointAt(p, 0);
  for (let i = 1; i <= 5000; i++) {
    const cur = core.pointAt(p, i / 10000);
    walked += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  close(walked, p.totalLength / 2, p.totalLength * 0.002);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
