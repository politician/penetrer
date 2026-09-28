# Pixel Trail Prank — Design

Date: 2026-09-28

## Purpose

A single-page prank to leave open on an unattended coworker's browser. The page
fills the screen with black. A small spermatozoid swims around it, and the path
it travels lights up as pixel art, progressively revealing an outlined penis.
It starts by itself on page load and takes five minutes to complete.

Success: the coworker returns to a live, moving screen with a recognisable
drawing on it. Nothing to install, nothing to click, no way to arrive at a
frozen or half-meaningless screen.

## Constraints

- One self-contained `index.html`. No build step, no npm, no dependencies, no
  network access at runtime. It must work opened from a local path or a USB
  stick, and still work if dropped on a static host later.
- No sound.
- Desktop browser only. No mobile layout, no persistence, no analytics.
- Not published publicly; this is for the author's own office.

## Behaviour

### Startup

The animation begins on page load with no user interaction.

Browsers do not permit a page to enter fullscreen without a user gesture, so
"fullscreen" means the page fills the viewport: black background, no margins,
no scrollbars. Clicking anywhere outside the speed controls requests real
fullscreen, so setup is: open the page, click once, walk away.

The mouse cursor hides after 2 seconds without mouse movement and reappears on
movement.

### The drawing

The outline is a single closed contour: up one side of the shaft, around the
head, down the other side, around the balls, and back to the start. The sperm
traces it in one unbroken stroke and finishes exactly where it began. There are
no pen-lifts, no interior detail and no separate strokes.

Cells the sperm has crossed are filled white and stay filled for the life of the
page. The trail is never cleared.

### Timing

A complete traversal of the outline takes 300 seconds at 1x, 100 seconds at 3x
and 60 seconds at 5x.

At any pixel size visible as pixel art this works out to roughly one newly
filled cell per second. The motion reads as smooth because the sperm glides
continuously between cells and its tail animates, not because cells fill
quickly. The slow reveal is intentional.

### Ending

On completing the loop the sperm keeps travelling along the same contour at the
current speed, indefinitely, retracing the line it drew rather than orbiting
around it or wandering off it. The trail stays on screen unchanged. The page never
clears, never restarts and never stops moving.

### Controls

Bottom-right of the viewport, inset 24px from both edges: the labels `1x`, `3x`
and `5x` in a small monospace font, laid out in a row.

- The selected speed is white at full opacity. The other two are white at 50%
  opacity.
- `1x` is selected on load.
- Clicking a label selects it and changes the speed multiplier from that moment
  forward. The sperm continues from its current position; the drawing never
  restarts and progress is never lost. Total elapsed time therefore depends on
  when the speed was changed, which is correct.
- These are the only controls on the page.

### Visual treatment

- Background: black. Trail and sperm: white.
- The sperm's head is a bright glowing dot. Its tail is a sine wave trailing
  along its recent positions, animating as it swims.
- Newly filled cells are painted bright and cool to plain white over
  approximately 1.5 seconds, producing a visible hot leading edge on the line.

## Architecture

Chosen approach: an authored polyline flattened to an arc-length table, rendered
onto a canvas pixel grid.

Two approaches were rejected. An SVG path animated with `stroke-dashoffset` is
far less code and resizes for free, but it draws a vector stroke rather than
pixels, and recovering a pixel look means fighting the medium. A true
cell-by-cell snake, where the sperm occupies one cell and hops to the next, is
the most literal reading of the brief, but at roughly one hop per second it is a
slideshow; adding interpolation to fix that arrives back at the chosen approach.

### Units

`index.html` contains the following units, each with one job:

**`OUTLINE`** — the shape asset. A closed loop of waypoints in a fixed 100 x 140
design coordinate space, built with a small helper that emits points along arcs
so the head and balls are real curves rather than chords. Pure data plus the arc
helper; depends on nothing.

**`path`** — geometry. Takes the waypoint loop, flattens it to a dense polyline
and builds a cumulative arc-length table. Exposes `totalLength` and
`pointAt(t)`, where `t` is a fraction from 0 to 1 of the way around the loop.
Pure functions; depends only on `OUTLINE`.

**`grid`** — the mapping from design space to screen. Given the viewport size,
computes cell size and origin such that the drawing is about 120 cells tall and
occupies about 85% of viewport height, then converts a design-space point to a
cell index. Pure functions; depends on nothing but its inputs.

**`trail`** — persistent state. Holds the set of filled cells plus a short queue
of cells still cooling, and paints them to the trail canvas. Depends on `grid`.

**`sperm`** — draws the head, glow and tail for a given position and recent
history onto the foreground canvas. Depends on nothing but its inputs.

**`loop`** — the animation driver. Owns the progress cursor and the speed
multiplier, advances progress each frame, asks `path` where the sperm is, tells
`trail` which cells were crossed and tells `sperm` to draw.

**`controls`** — the three speed labels and their click handling. Its only
effect on the rest of the page is setting the multiplier on `loop`.

### Rendering

Two stacked canvases sized to the viewport:

- A persistent trail canvas that is drawn onto and never cleared.
- A foreground canvas cleared every frame, carrying only the sperm.

### Animation loop

A single `requestAnimationFrame` loop. Each frame advances the progress cursor
by `(delta x speed) / 300s`, where `delta` is wall-clock time since the previous
frame clamped to a maximum of 100ms. The clamp matters because
`requestAnimationFrame` stops firing in a backgrounded tab: without it, the
drawing would fast-forward on return, and with it the animation simply resumes.

Cells crossed since the previous frame are handed to `trail` and enter the
cooling queue. Once cooled they are painted plain white and forgotten.

### Resize

Progress is stored as a fraction of total path length, never in pixels. On
window resize, `grid` recomputes cell size and origin and the trail canvas is
repainted from scratch up to the current progress. The drawing is reproduced
exactly at the new scale; nothing is lost or distorted.

## Testing

`test.html` loads the same pure functions, runs assertions in the browser and
prints pass/fail. No dependencies and no runner. It covers the two things that
can be silently wrong — the timing guarantee and the path geometry:

- `path.totalLength` equals the sum of the flattened segment lengths.
- `pointAt(0)` and `pointAt(1)` are the same point, proving the contour closes.
- Progress along the path is monotonic: `pointAt` advances steadily with no
  backwards jumps or discontinuities across the seam.
- 300 seconds of simulated frames at 1x advances progress from 0 to exactly 1.
- The same traversal takes 100 seconds at 3x and 60 seconds at 5x.
- A simulated frame delta larger than the clamp advances progress by no more
  than the clamp allows.
- Design-space points convert to the expected cell index, including points
  exactly on a cell boundary.

Appearance — the glow, the tail, the shape itself — is checked by eye in the
browser. The outline geometry is expected to need visual tuning after the first
run.

## Out of scope

Sound, mobile layout, persistence, keyboard shortcuts, any speed other than 1x /
3x / 5x, and any drawing other than this one.
