# Pixel Trail Prank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained `index.html` in which a spermatozoid swims a closed contour on a black fullscreen page, filling pixel cells behind it to reveal an outlined drawing over five minutes, with 1x/3x/5x speed controls bottom-right.

**Architecture:** The outline is a hand-authored closed polyline in a fixed 100x140 design space, flattened into a cumulative arc-length table so "how far around the loop are we" is a single number. Two stacked canvases fill the viewport: a persistent trail canvas that is drawn onto and never cleared, and a foreground canvas cleared every frame carrying only the sperm. One `requestAnimationFrame` loop advances a progress cursor by wall-clock time scaled by the speed multiplier.

**Tech Stack:** Plain HTML, CSS and JavaScript. No build step, no npm, no dependencies, no runtime network access. Node 18+ is used only to run the test suite from the command line.

**Spec:** `docs/superpowers/specs/2026-09-28-pixel-trail-prank-design.md`

## Global Constraints

- One self-contained `index.html`. All CSS and JS inline. It must work opened directly from a `file://` path, so no ES module `import`, no `<script src=>` to sibling files, and no fetch of any kind.
- No dependencies, no npm, no build step, no package.json.
- No sound, no persistence, no analytics, no mobile layout.
- A full traversal of the outline takes exactly `DURATION_1X = 300` seconds at 1x, 100 seconds at 3x, 60 seconds at 5x.
- Frame deltas are clamped to `MAX_DELTA = 0.1` seconds.
- Design space is `DESIGN_W = 100` by `DESIGN_H = 140`, y increasing downward.
- The drawing is `CELLS_TALL = 120` cells tall and occupies `FILL_FRACTION = 0.85` of the viewport.
- Freshly filled cells cool over `HOT_SECONDS = 1.5` seconds.
- Background `#000`; trail and sperm white.
- Speed controls are exactly the three labels `1x`, `3x`, `5x`, bottom-right, inset 24px, selected at full opacity and unselected at 50% opacity.

**Deviation from the spec, deliberate:** the spec calls for a `test.html` that prints pass/fail in the browser. This plan uses `test/run.js`, run with `node test/run.js`, which reads `index.html`, extracts the `<script id="core">` block and evaluates it. Same guarantee — no npm, no dependencies, and the shipped file stays a single self-contained page — but the suite is runnable from the command line, which the browser version is not. Appearance is still checked by eye in the browser.

## Review Focus

1. **Backgrounded tab.** `requestAnimationFrame` stops firing when the tab is hidden; on return the first frame delta is minutes long and the drawing would fast-forward to completion. Pinned in Task 1.
2. **Zero or negative frame delta.** The first frame has no previous timestamp, and clock adjustments can produce a negative delta; progress must never run backwards or the trail would appear to un-draw. Pinned in Task 1.
3. **Narrow or portrait viewport.** Sizing the drawing by viewport height alone lets it overflow horizontally on a narrow window, cutting the balls off at the screen edges. Pinned in Task 3.
4. **Window resized mid-draw.** Cell identity must depend only on design coordinates, not on viewport size, or the trail repaints as a different shape after a resize. Pinned in Task 3.
5. **Progress past completion.** After a full traversal the sperm keeps travelling, so progress exceeds 1.0; the trail must stop growing at exactly 1.0 while the sperm keeps moving. Pinned in Task 4.

---

### Task 1: Page skeleton, test harness, and timing math

**Files:**
- Create: `index.html`
- Create: `test/run.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `index.html` containing a `<script id="core">` block holding pure, DOM-free logic and a `<script id="app">` block holding everything that touches the DOM. Later tasks add to these two blocks and never create new files. The core block exports, via the return statement at the end of `test/run.js`'s extraction, the constants `DESIGN_W`, `DESIGN_H`, `CELLS_TALL`, `FILL_FRACTION`, `DURATION_1X`, `MAX_DELTA`, `HOT_SECONDS` and the function `advance(progress: number, delta: number, speed: number) -> number`.

- [ ] **Step 1: Create the page skeleton**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>swim</title>
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
canvas { position: fixed; inset: 0; display: block; }
</style>
</head>
<body>
<canvas id="trail"></canvas>
<canvas id="fg"></canvas>

<script id="core">
// Pure logic. No DOM, no timers, no globals from the page.
// Everything in this block is extracted and unit-tested by test/run.js.

const DESIGN_W = 100;        // design-space width
const DESIGN_H = 140;        // design-space height, y increases downward
const CELLS_TALL = 120;      // drawing height in grid cells
const FILL_FRACTION = 0.85;  // fraction of the viewport the drawing occupies
const DURATION_1X = 300;     // seconds for one full traversal at 1x
const MAX_DELTA = 0.1;       // seconds; clamp so a backgrounded tab resumes
const HOT_SECONDS = 1.5;     // how long a freshly filled cell stays bright
</script>

<script id="app">
// DOM, canvas and animation.
</script>
</body>
</html>
```

- [ ] **Step 2: Create the test harness with no tests yet**

Create `test/run.js`:

```js
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

// --- tests go here ---

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the harness to confirm extraction works**

Run: `node test/run.js`
Expected: exits 0 and prints `0 passed, 0 failed`. If it prints the "no `<script id="core">` block" error, the regex and the HTML have drifted apart — fix before continuing.

- [ ] **Step 4: Write the failing tests for `advance`**

Add above the `--- tests go here ---` marker's position in `test/run.js`:

```js
test('advance moves progress forward proportionally to delta and speed', () => {
  close(core.advance(0, 30, 1), 0.1, 1e-12);
  close(core.advance(0, 0.05, 3), 0.05 * 3 / 300, 1e-12);
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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `node test/run.js`
Expected: every `advance` test FAILs with `core.advance is not a function`.

- [ ] **Step 6: Implement `advance`**

Append inside the `<script id="core">` block of `index.html`, after the constants:

```js
// Advance the progress cursor. delta is wall-clock seconds since the previous
// frame, clamped so a backgrounded tab resumes rather than fast-forwarding, and
// floored at zero so progress never runs backwards.
function advance(progress, delta, speed) {
  const d = Math.min(Math.max(delta, 0), MAX_DELTA);
  return progress + (d * speed) / DURATION_1X;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node test/run.js`
Expected: `6 passed, 0 failed`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add index.html test/run.js
git commit -m "feat: page skeleton, node test harness, and timing math"
```

---

### Task 2: Outline geometry and arc-length path

**Files:**
- Modify: `index.html` (`<script id="core">` block)
- Modify: `test/run.js`

**Interfaces:**
- Consumes: `DESIGN_W`, `DESIGN_H` from Task 1.
- Produces:
  - `arcPoints(cx, cy, r, startDeg, endDeg) -> Array<[x, y]>` — points along a circular arc, inclusive of both ends. Angles are in degrees, measured counter-clockwise from the positive x axis, with y increasing downward, so a point is `[cx + r*cos(a), cy - r*sin(a)]`. Going clockwise on screen means the end angle is lower than the start angle.
  - `OUTLINE: Array<[x, y]>` — the closed contour in design space. The closing segment from the last point back to the first is implicit.
  - `buildPath(points) -> { points, cumulative, totalLength }` — `points` is the input with consecutive duplicates and a duplicated closing point removed; `cumulative[i]` is the arc length from `points[0]` to `points[i]`, `cumulative[0] === 0`, and `cumulative[points.length] === totalLength` including the closing segment.
  - `pointAt(path, t) -> [x, y]` — position a fraction `t` of the way around the loop. `t` wraps, so `t = 1` and `t = 0` give the same point and negative `t` is valid.

- [ ] **Step 1: Add the new names to the harness export list**

In `test/run.js`, extend `EXPORTS`:

```js
const EXPORTS = [
  'DESIGN_W', 'DESIGN_H', 'CELLS_TALL', 'FILL_FRACTION',
  'DURATION_1X', 'MAX_DELTA', 'HOT_SECONDS',
  'advance',
  'arcPoints', 'OUTLINE', 'buildPath', 'pointAt',
];
```

- [ ] **Step 2: Write the failing tests**

Add to `test/run.js` before the summary lines:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node test/run.js`
Expected: the new tests FAIL with `core.arcPoints is not a function` and `core.buildPath is not a function`; the six timing tests still pass.

- [ ] **Step 4: Implement the geometry and path**

Append inside the `<script id="core">` block of `index.html`:

```js
// --- outline geometry -------------------------------------------------------
// Angles are degrees counter-clockwise from the positive x axis, with y running
// downward, so clockwise-on-screen means the angle decreases.
function arcPoints(cx, cy, r, startDeg, endDeg) {
  const sweepLength = Math.abs(endDeg - startDeg) * Math.PI / 180 * r;
  const steps = Math.max(2, Math.ceil(sweepLength * 2)); // ~2 points per design unit
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  return pts;
}

const HEAD = { cx: 50, cy: 24, r: 16 };
const SHAFT_TOP = 24;
const SHAFT_BOTTOM = 88;
const RIGHT_BALL = { cx: 66, cy: 108, r: 20 };
const LEFT_BALL = { cx: 34, cy: 108, r: 20 };
// The two ball circles are 32 apart with radius 20, so they intersect at
// (50, 96) and (50, 120). The lower intersection is the notch between them.
const NOTCH_RIGHT_DEG = -143.13; // (50,120) as seen from RIGHT_BALL
const NOTCH_LEFT_DEG = -36.87;   // (50,120) as seen from LEFT_BALL

// One closed contour, traced clockwise from the top of the head: over the right
// of the head, down the right of the shaft, around the right ball, up into the
// notch, around the left ball, up the left of the shaft, over the left of the
// head, back to the start.
const OUTLINE = [].concat(
  arcPoints(HEAD.cx, HEAD.cy, HEAD.r, 90, 0),
  [[RIGHT_BALL.cx, SHAFT_BOTTOM]],
  arcPoints(RIGHT_BALL.cx, RIGHT_BALL.cy, RIGHT_BALL.r, 90, NOTCH_RIGHT_DEG),
  arcPoints(LEFT_BALL.cx, LEFT_BALL.cy, LEFT_BALL.r, NOTCH_LEFT_DEG, -270),
  [[LEFT_BALL.cx, SHAFT_TOP]],
  arcPoints(HEAD.cx, HEAD.cy, HEAD.r, 180, 90)
);

// --- arc-length path --------------------------------------------------------
// Joins between sections repeat a point, and the final arc lands back on the
// first point, so both are stripped before measuring.
function buildPath(points) {
  const pts = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push(p);
  }
  while (pts.length > 1) {
    const first = pts[0], last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) pts.pop();
    else break;
  }
  const cumulative = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    cumulative.push(cumulative[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { points: pts, cumulative, totalLength: cumulative[pts.length] };
}

// Position a fraction t of the way around the loop. t wraps, so t=1 equals t=0
// and negative values are valid (the tail uses them).
function pointAt(path, t) {
  const frac = t - Math.floor(t);
  const target = frac * path.totalLength;
  const cum = path.cumulative;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const segLength = cum[lo + 1] - cum[lo];
  const u = segLength > 1e-12 ? (target - cum[lo]) / segLength : 0;
  const a = path.points[lo];
  const b = path.points[(lo + 1) % path.points.length];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/run.js`
Expected: `16 passed, 0 failed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.html test/run.js
git commit -m "feat: outline geometry and arc-length path"
```

---

### Task 3: Viewport grid

**Files:**
- Modify: `index.html` (`<script id="core">` block)
- Modify: `test/run.js`

**Interfaces:**
- Consumes: `DESIGN_W`, `DESIGN_H`, `CELLS_TALL`, `FILL_FRACTION` from Task 1.
- Produces:
  - `computeGrid(viewportW, viewportH) -> { cell, cellsWide, cellsTall, originX, originY, unitsToCells }` — `cell` is the cell edge in CSS pixels; `originX`/`originY` place cell (0,0) so the drawing is centred; `unitsToCells` is `CELLS_TALL / DESIGN_H`.
  - `pointToCell(grid, x, y) -> { cx, cy }` — integer cell coordinates for a design-space point. Depends only on `unitsToCells`, never on viewport size.
  - `cellKey(cx, cy) -> string` — the identity of a cell in the filled-cell set.

- [ ] **Step 1: Add the new names to the harness export list**

In `test/run.js`, extend `EXPORTS` with `'computeGrid', 'pointToCell', 'cellKey'`.

- [ ] **Step 2: Write the failing tests**

Add to `test/run.js` before the summary lines:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node test/run.js`
Expected: the new tests FAIL with `core.computeGrid is not a function`; the previous 16 still pass.

- [ ] **Step 4: Implement the grid**

Append inside the `<script id="core">` block of `index.html`:

```js
// --- viewport grid ----------------------------------------------------------
// Cell size is limited by both viewport dimensions, so a narrow or portrait
// window scales the drawing down rather than cropping it.
function computeGrid(viewportW, viewportH) {
  const cellsWide = Math.ceil(DESIGN_W * CELLS_TALL / DESIGN_H);
  const cell = Math.min(
    viewportH * FILL_FRACTION / CELLS_TALL,
    viewportW * FILL_FRACTION / cellsWide
  );
  const drawW = cell * cellsWide;
  const drawH = cell * CELLS_TALL;
  return {
    cell,
    cellsWide,
    cellsTall: CELLS_TALL,
    originX: (viewportW - drawW) / 2,
    originY: (viewportH - drawH) / 2,
    unitsToCells: CELLS_TALL / DESIGN_H,
  };
}

// Cell coordinates depend only on the design point, never on the viewport, so
// the same drawing repaints identically at any size.
function pointToCell(grid, x, y) {
  return {
    cx: Math.floor(x * grid.unitsToCells),
    cy: Math.floor(y * grid.unitsToCells),
  };
}

function cellKey(cx, cy) {
  return cx + ',' + cy;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/run.js`
Expected: `23 passed, 0 failed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.html test/run.js
git commit -m "feat: viewport grid and design-space to cell mapping"
```

---

### Task 4: Cells crossed between two progress values

**Files:**
- Modify: `index.html` (`<script id="core">` block)
- Modify: `test/run.js`

**Interfaces:**
- Consumes: `pointAt`, `pointToCell`, `cellKey` from Tasks 2 and 3.
- Produces: `cellsBetween(path, grid, fromT, toT) -> Array<{ cx, cy, key }>` — every cell the contour passes through between the two progress values, in travel order, with no repeats within the call. Both ends are clamped to `[0, 1]`, so the trail stops growing at completion. Returns `[]` when the clamped range is empty. Cells already filled on previous frames are still returned; the caller keeps the global filled set.
- Guarantees: sampling is anchored to a fixed lattice around the whole loop, so the union of many small ranges equals the result of one large range covering the same span. Task 5 relies on this — it fills cells frame by frame but repaints from a single whole-range call after a resize, and the two must produce the same drawing.

- [ ] **Step 1: Add `cellsBetween` to the harness export list**

In `test/run.js`, extend `EXPORTS` with `'cellsBetween'`.

- [ ] **Step 2: Write the failing tests**

Add to `test/run.js` before the summary lines:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node test/run.js`
Expected: the new tests FAIL with `core.cellsBetween is not a function`; the previous 23 still pass.

- [ ] **Step 4: Implement `cellsBetween`**

Append inside the `<script id="core">` block of `index.html`:

```js
// --- cells crossed ----------------------------------------------------------
// Samples the contour finely enough that no cell can be stepped over, so the
// line is continuous however small a frame's advance was. Both ends clamp to
// [0,1]: the sperm keeps travelling after one full lap, but the trail does not
// grow past completion.
function cellsBetween(path, grid, fromT, toT) {
  const start = Math.min(Math.max(fromT, 0), 1);
  const end = Math.min(Math.max(toT, 0), 1);
  if (end <= start) return [];
  // Sample points sit on one fixed lattice around the whole loop, four per
  // cell, and a range takes the lattice points that fall inside it. Subdividing
  // each range separately instead would shift the sample positions with the
  // range, so drawing the contour in thousands of small frames would graze a
  // slightly different set of cells than one whole-range call -- and the
  // repaint after a resize would silently differ from what was on screen.
  const samples = Math.max(1, Math.ceil(path.totalLength * grid.unitsToCells * 4));
  const first = Math.ceil(start * samples);
  const last = Math.floor(end * samples);
  const cells = [];
  const seen = new Set();
  for (let i = first; i <= last; i++) {
    const p = pointAt(path, i / samples);
    const c = pointToCell(grid, p[0], p[1]);
    const key = cellKey(c.cx, c.cy);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ cx: c.cx, cy: c.cy, key });
  }
  return cells;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/run.js`
Expected: `29 passed, 0 failed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add index.html test/run.js
git commit -m "feat: map progress ranges onto the cells the contour crosses"
```

---

### Task 5: Rendering and the animation loop

**Files:**
- Modify: `index.html` (`<script id="app">` block)

**Interfaces:**
- Consumes: `OUTLINE`, `buildPath`, `pointAt`, `computeGrid`, `cellsBetween`, `advance`, `HOT_SECONDS` from Tasks 1-4. Both `<script>` blocks share the page's top-level scope, so the app block calls these directly with no import.
- Produces: module-level `speed` (a number, mutated by Task 6), `rebuild()` (resizes canvases, recomputes the grid and repaints the trail from scratch up to current progress — Task 6 calls it on resize), and a running `requestAnimationFrame` loop.

This task has no unit tests. It is canvas drawing, verified by eye in the browser at the end of the task. All pure logic it depends on is already covered by Tasks 1-4.

- [ ] **Step 1: Implement the renderer and loop**

Replace the contents of the `<script id="app">` block in `index.html`:

```js
const trailCanvas = document.getElementById('trail');
const fgCanvas = document.getElementById('fg');

const path = buildPath(OUTLINE);
let grid = null;
let trailCtx = null;
let fgCtx = null;
let progress = 0;
let speed = 1;
let lastTime = null;
const filled = new Set();
let hot = [];

const TAIL_UNITS = 12;      // how far behind the head the tail reaches
const TAIL_SEGMENTS = 14;
const TAIL_AMPLITUDE = 2.2; // design units of sideways wiggle at the tip
const TAIL_WAVELENGTH = 2.4;
const TAIL_SPEED = 7;

// Back the canvas with device pixels so cells have crisp edges on a HiDPI
// screen, then work in CSS pixels for everything else.
function sizeCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function paintCell(ctx, cx, cy, style) {
  ctx.fillStyle = style;
  ctx.fillRect(
    grid.originX + cx * grid.cell,
    grid.originY + cy * grid.cell,
    grid.cell + 0.5, // half-pixel overlap so neighbours leave no hairline seam
    grid.cell + 0.5
  );
}

function toScreen(p) {
  return [
    grid.originX + p[0] * grid.unitsToCells * grid.cell,
    grid.originY + p[1] * grid.unitsToCells * grid.cell,
  ];
}

// Recompute everything that depends on viewport size and repaint the trail from
// the path itself. Progress is a fraction, so the drawing is reproduced exactly.
function rebuild() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  grid = computeGrid(w, h);
  trailCtx = sizeCanvas(trailCanvas, w, h);
  fgCtx = sizeCanvas(fgCanvas, w, h);
  filled.clear();
  hot = [];
  trailCtx.clearRect(0, 0, w, h);
  for (const c of cellsBetween(path, grid, 0, progress)) {
    if (filled.has(c.key)) continue;
    filled.add(c.key);
    paintCell(trailCtx, c.cx, c.cy, '#ffffff');
  }
}

function drawHot(nowSec) {
  hot = hot.filter(h => nowSec - h.born < HOT_SECONDS);
  if (!hot.length) return;
  fgCtx.save();
  fgCtx.globalCompositeOperation = 'lighter';
  for (const h of hot) {
    const age = (nowSec - h.born) / HOT_SECONDS;
    paintCell(fgCtx, h.cx, h.cy, 'rgba(255,255,255,' + (0.9 * (1 - age)) + ')');
  }
  fgCtx.restore();
}

// The tail is sampled from the path behind the head and pushed sideways by a
// travelling sine wave, so it always follows the line the sperm is drawing.
function drawSperm(nowSec) {
  const stepT = (TAIL_UNITS / TAIL_SEGMENTS) / path.totalLength;
  const pts = [];
  for (let i = 0; i <= TAIL_SEGMENTS; i++) {
    const t = progress - i * stepT;
    const p = pointAt(path, t);
    const ahead = pointAt(path, t + stepT * 0.5);
    const behind = pointAt(path, t - stepT * 0.5);
    const dx = ahead[0] - behind[0];
    const dy = ahead[1] - behind[1];
    const len = Math.hypot(dx, dy) || 1;
    const ratio = i / TAIL_SEGMENTS;
    const wave = Math.sin(nowSec * TAIL_SPEED - i * TAIL_WAVELENGTH)
      * TAIL_AMPLITUDE * ratio;
    pts.push(toScreen([p[0] + (-dy / len) * wave, p[1] + (dx / len) * wave]));
  }

  fgCtx.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const fade = 1 - i / pts.length;
    fgCtx.beginPath();
    fgCtx.moveTo(pts[i][0], pts[i][1]);
    fgCtx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    fgCtx.lineWidth = Math.max(0.6, grid.cell * 0.9 * fade);
    fgCtx.strokeStyle = 'rgba(255,255,255,' + (0.85 * fade) + ')';
    fgCtx.stroke();
  }

  const head = pts[0];
  const r = grid.cell * 2.2;
  const glow = fgCtx.createRadialGradient(head[0], head[1], 0, head[0], head[1], r * 3);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  fgCtx.fillStyle = glow;
  fgCtx.beginPath();
  fgCtx.arc(head[0], head[1], r * 3, 0, Math.PI * 2);
  fgCtx.fill();
  fgCtx.fillStyle = '#ffffff';
  fgCtx.beginPath();
  fgCtx.ellipse(head[0], head[1], r, r * 0.72, 0, 0, Math.PI * 2);
  fgCtx.fill();
}

function frame(now) {
  const nowSec = now / 1000;
  const delta = lastTime === null ? 0 : nowSec - lastTime;
  lastTime = nowSec;

  const previous = progress;
  progress = advance(progress, delta, speed);

  for (const c of cellsBetween(path, grid, previous, progress)) {
    if (filled.has(c.key)) continue;
    filled.add(c.key);
    paintCell(trailCtx, c.cx, c.cy, '#ffffff');
    hot.push({ cx: c.cx, cy: c.cy, born: nowSec });
  }

  fgCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  drawHot(nowSec);
  drawSperm(nowSec);

  requestAnimationFrame(frame);
}

rebuild();
requestAnimationFrame(frame);
```

- [ ] **Step 2: Confirm the unit tests still pass**

Run: `node test/run.js`
Expected: `29 passed, 0 failed`. The core block was not touched, so nothing should have changed. If the harness now fails to find the core block, an edit landed in the wrong `<script>`.

- [ ] **Step 3: Verify by eye in the browser**

Open `index.html` in a browser and check, in order:

1. The page is black, fills the window, and has no scrollbars.
2. The sperm is visible immediately and moving without being clicked.
3. Its tail wiggles continuously and trails behind the head along the line.
4. The head has a visible glow.
5. A white line grows behind it, roughly one new cell per second.
6. Freshly drawn cells are brighter than the settled line and cool within about a second and a half.
7. Letting it run, the shape that emerges is the intended outline, not a tangle.

Waiting five minutes for the full shape is unnecessary at this stage: temporarily set `let speed = 5;` in the app block to watch a full lap in 60 seconds, confirm the shape and the loop, then set it back to `let speed = 1;` before committing. Note what needs tuning; the outline constants in the core block are the knobs.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: canvas rendering, hot trail, sperm, and animation loop"
```

---

### Task 6: Controls, fullscreen, cursor hiding, and resize

**Files:**
- Modify: `index.html` (markup, `<style>`, and `<script id="app">` block)

**Interfaces:**
- Consumes: `speed` and `rebuild()` from Task 5.
- Produces: the finished page. Nothing downstream consumes it.

- [ ] **Step 1: Add the controls markup**

In `index.html`, after `<canvas id="fg"></canvas>` and before the `<script id="core">` block:

```html
<div id="controls">
  <button type="button" data-speed="1" class="active">1x</button>
  <button type="button" data-speed="3">3x</button>
  <button type="button" data-speed="5">5x</button>
</div>
```

- [ ] **Step 2: Add the controls styling**

Append inside the existing `<style>` block:

```css
#controls {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2;
  display: flex;
  gap: 14px;
  font: 14px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#controls button {
  margin: 0;
  padding: 4px;
  border: 0;
  background: none;
  font: inherit;
  color: #fff;
  opacity: 0.5;
  cursor: pointer;
}
#controls button.active { opacity: 1; }
body.hide-cursor, body.hide-cursor #controls button { cursor: none; }
```

- [ ] **Step 3: Wire up the controls, fullscreen, cursor and resize**

Append to the `<script id="app">` block in `index.html`, after the `requestAnimationFrame(frame);` line:

```js
const controls = document.getElementById('controls');

// Changing speed takes effect from this moment on; progress is untouched, so
// the drawing continues from where the sperm is rather than restarting.
controls.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  speed = Number(button.dataset.speed);
  for (const b of controls.querySelectorAll('button')) {
    b.classList.toggle('active', b === button);
  }
});

// A page cannot enter fullscreen on its own, so any click outside the controls
// asks for it: open the page, click once, walk away.
document.addEventListener('click', (event) => {
  if (event.target.closest('#controls')) return;
  if (document.fullscreenElement) return;
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
});

let cursorTimer = null;
function pokeCursor() {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 2000);
}
document.addEventListener('mousemove', pokeCursor);
pokeCursor();

window.addEventListener('resize', rebuild);
```

- [ ] **Step 4: Confirm the unit tests still pass**

Run: `node test/run.js`
Expected: `29 passed, 0 failed`.

- [ ] **Step 5: Verify the whole page by eye**

Open `index.html` in a browser and check:

1. `1x` is white and `3x`/`5x` are visibly dimmer, bottom-right.
2. Clicking `5x` makes it white, dims `1x`, and the sperm speeds up without the drawing resetting or the existing trail disappearing.
3. Clicking back to `1x` slows it down, again with no reset.
4. Clicking anywhere else on the page enters fullscreen. Pressing Escape leaves it, and the drawing survives both transitions with the trail intact.
5. Leaving the mouse still for two seconds hides the cursor; moving it brings it back.
6. Resizing the window rescales the drawing and keeps every cell already drawn, in the same shape.
7. Making the window tall and narrow keeps the whole drawing on screen with nothing cropped.
8. Switching to another tab for a minute and coming back resumes from where it was, rather than jumping ahead.
9. At `5x`, a full lap completes in about 60 seconds; the trail then stops growing while the sperm keeps travelling along the line it drew, indefinitely.
10. At `1x` from a fresh reload, the drawing is still in progress after four minutes and complete at about five.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: speed controls, click-to-fullscreen, cursor hiding, and resize"
```
