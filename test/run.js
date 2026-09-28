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
  'computeGrid', 'pointToCell', 'cellKey',
  'cellsBetween',
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

test('the drawing is CELLS_TALL cells tall and fills FILL_FRACTION of a wide viewport', () => {
  const g = core.computeGrid(1400, 900);
  close(g.cell * g.cellsTall, 900 * core.FILL_FRACTION, 1e-9, 'drawing height');
  assert(g.cellsTall === core.CELLS_TALL, 'cellsTall');
  assert(g.cellsWide === 86, 'expected 86 cells wide, got ' + g.cellsWide);
});

test('the drawing is centred in the viewport', () => {
  const g = core.computeGrid(1400, 900);
  const drawW = g.cell * g.cellsWide, drawH = g.cell * g.cellsTall;
  close(g.originX, (1400 - drawW) / 2, 1e-9, 'originX');
  close(g.originY, (900 - drawH) / 2, 1e-9, 'originY');
});

// Review Focus 3: a narrow window must not crop the drawing horizontally.
test('a narrow viewport sizes the drawing by width so it never overflows', () => {
  const g = core.computeGrid(300, 2000);
  const drawW = g.cell * g.cellsWide, drawH = g.cell * g.cellsTall;
  assert(drawW <= 300 * core.FILL_FRACTION + 1e-9, 'width overflows: ' + drawW);
  assert(drawH <= 2000 * core.FILL_FRACTION + 1e-9, 'height overflows: ' + drawH);
  assert(g.originX >= 0 && g.originY >= 0, 'origin went negative');
});

test('a tiny viewport still yields a usable cell size', () => {
  const g = core.computeGrid(120, 80);
  assert(g.cell > 0, 'cell size must be positive, got ' + g.cell);
  assert(Number.isFinite(g.originX) && Number.isFinite(g.originY), 'origin must be finite');
});

test('pointToCell floors onto the cell grid, including exact boundaries', () => {
  const g = core.computeGrid(1400, 900);
  const unit = 1 / g.unitsToCells; // design units per cell
  assert(core.pointToCell(g, 0, 0).cx === 0, 'origin cell');
  assert(core.pointToCell(g, unit * 3, unit * 7).cx === 3, 'boundary lands in the higher cell');
  assert(core.pointToCell(g, unit * 3, unit * 7).cy === 7, 'boundary lands in the higher cell');
  assert(core.pointToCell(g, unit * 3 - 1e-9, 0).cx === 2, 'just below the boundary');
});

// Review Focus 4: a resize must repaint the identical shape.
test('cell identity is independent of viewport size', () => {
  const a = core.computeGrid(1400, 900);
  const b = core.computeGrid(800, 600);
  const c = core.computeGrid(300, 2000);
  for (const [x, y] of core.OUTLINE) {
    const ca = core.pointToCell(a, x, y);
    const cb = core.pointToCell(b, x, y);
    const cc = core.pointToCell(c, x, y);
    assert(ca.cx === cb.cx && ca.cy === cb.cy, 'differs between 1400x900 and 800x600');
    assert(ca.cx === cc.cx && ca.cy === cc.cy, 'differs between 1400x900 and 300x2000');
  }
});

test('cellKey distinguishes cells and is stable', () => {
  assert(core.cellKey(3, 7) === core.cellKey(3, 7), 'stable');
  assert(core.cellKey(3, 7) !== core.cellKey(7, 3), 'distinguishes');
  assert(core.cellKey(-1, 2) !== core.cellKey(1, 2), 'handles negatives');
});

test('cellsBetween returns nothing for an empty or reversed range', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  assert(core.cellsBetween(p, g, 0.3, 0.3).length === 0, 'empty range');
  assert(core.cellsBetween(p, g, 0.5, 0.2).length === 0, 'reversed range');
});

test('cellsBetween returns cells in travel order with no repeats in a call', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  const cells = core.cellsBetween(p, g, 0, 0.25);
  assert(cells.length > 40, 'a quarter of the contour is many cells, got ' + cells.length);
  const seen = new Set();
  for (const c of cells) {
    assert(!seen.has(c.key), 'repeated cell in one call: ' + c.key);
    seen.add(c.key);
    assert(c.key === core.cellKey(c.cx, c.cy), 'key must match coordinates');
  }
});

test('consecutive cells from one call are adjacent, never skipping a gap', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  const cells = core.cellsBetween(p, g, 0, 1);
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.abs(cells[i].cx - cells[i - 1].cx);
    const dy = Math.abs(cells[i].cy - cells[i - 1].cy);
    assert(dx <= 1 && dy <= 1,
      'gap between ' + cells[i - 1].key + ' and ' + cells[i].key);
  }
});

test('a full traversal covers the whole contour', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  const cells = core.cellsBetween(p, g, 0, 1);
  assert(cells.length > 300 && cells.length < 360,
    'expected roughly 326 cells, got ' + cells.length);
});

test('many small frames cover exactly the same cells as one big call', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  const whole = new Set(core.cellsBetween(p, g, 0, 1).map(c => c.key));
  const stepped = new Set();
  const frames = 18000;
  for (let i = 0; i < frames; i++) {
    for (const c of core.cellsBetween(p, g, i / frames, (i + 1) / frames)) {
      stepped.add(c.key);
    }
  }
  assert(whole.size === stepped.size,
    'whole=' + whole.size + ' stepped=' + stepped.size);
  for (const k of whole) assert(stepped.has(k), 'frame-by-frame missed ' + k);
});

// Review Focus 5: after completion the sperm keeps moving but the trail stops.
test('cellsBetween clamps at completion so the trail stops growing', () => {
  const p = core.buildPath(core.OUTLINE);
  const g = core.computeGrid(1400, 900);
  const clamped = core.cellsBetween(p, g, 0.99, 1.4).map(c => c.key);
  const exact = core.cellsBetween(p, g, 0.99, 1).map(c => c.key);
  assert(clamped.length === exact.length, 'overshoot added cells');
  for (let i = 0; i < exact.length; i++) assert(clamped[i] === exact[i], 'cell ' + i);
  assert(core.cellsBetween(p, g, 1, 1.5).length === 0, 'past completion must be empty');
  assert(core.cellsBetween(p, g, 2.2, 2.7).length === 0, 'second lap must be empty');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
