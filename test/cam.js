'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { screenPoint, mouthTarget, moveParticle, matchTargets } = require('../cam/core.js');

assert.deepEqual(screenPoint({ x: .25, y: .5 }, 1280, 720, 1280, 720), { x: 960, y: 360 });
assert.deepEqual(screenPoint({ x: .5, y: .5 }, 1280, 720, 360, 640), { x: 180, y: 320 });
assert.deepEqual(screenPoint({ x: .5, y: .5 }, 720, 1280, 1280, 720), { x: 640, y: 360 });
const face = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
face[13] = { x: .5, y: .55 }; face[14] = { x: .5, y: .65 };
face[61] = { x: .4, y: .6 }; face[291] = { x: .6, y: .6 };
const mouth = mouthTarget(face, 1000, 1000, 1000, 1000);
assert.equal(mouth.x, 500); assert.equal(mouth.y, 600); assert.equal(mouth.radius, 50);
assert.equal(moveParticle({ x: 0, y: 0, speed: 1000 }, { x: 40, y: 0, radius: 5 }, .05), false);
assert.equal(moveParticle({ x: 0, y: 0, speed: 100 }, { x: 0, y: 0, radius: 5 }, 0), false);
const particle = { x: 0, y: 0, speed: 100 };
assert.equal(moveParticle(particle, { x: 200, y: 0, radius: 5 }, 60), true);
assert.equal(particle.x, 5); // A resumed tab cannot jump sixty seconds ahead.

const mouths = [{ x: 100, y: 100, radius: 10 }, { x: 400, y: 100, radius: 10 }];
const first = matchTargets([], mouths, 0);
assert.deepEqual(first.targets.map(t => t.id), [0, 1]);
const swapped = matchTargets(first.targets, [mouths[1], mouths[0]], first.nextId);
assert.deepEqual(swapped.targets.map(t => t.id), [1, 0], 'face ordering must not swap particle destinations');
const remaining = matchTargets(swapped.targets, [mouths[0]], swapped.nextId);
assert.equal(remaining.targets[0].id, 0);
const joined = matchTargets(remaining.targets, mouths, remaining.nextId);
assert.deepEqual(joined.targets.map(t => t.id), [0, 2], 'new people receive a fresh identity');
assert.equal(matchTargets(joined.targets, [], joined.nextId).targets.length, 0);
const crowded = matchTargets([], Array.from({ length: 8 }, (_, i) => ({ x: i * 100, y: 100, radius: 10 })), 0);
assert.equal(new Set(crowded.targets.map(t => t.id)).size, 8);

// Exercise browser lifecycle without a physical camera or network models.
const app = fs.readFileSync(path.join(__dirname, '../cam/app.js'), 'utf8')
  .replace('import(VISION_URL)', 'loadVision()')
  .replace('  begin();\n})();', '  return begin();\n})();');
function harness(getUserMedia, loadVision) {
  const elements = {};
  for (const id of ['camera', 'overlay', 'start', 'stop', 'fullscreen', 'status']) {
    elements[id] = { hidden: false, disabled: false, textContent: '', events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      getContext() { return { clearRect() {}, setTransform() {} }; },
      async play() {},
    };
  }
  let nextFrame;
  const draws = [];
  const drawingContext = new Proxy({ translate(x, y) { draws.push({ x, y }); } }, {
    get(target, key) { return target[key] || (() => {}); },
  });
  elements.overlay.getContext = () => drawingContext;
  const context = {
    CamMath: require('../cam/core.js'),
    document: { getElementById: id => elements[id], documentElement: {}, addEventListener() {} },
    window: { isSecureContext: true, innerWidth: 360, innerHeight: 640, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => 100 },
    requestAnimationFrame: fn => { nextFrame = fn; return 1; }, cancelAnimationFrame() {}, loadVision,
  };
  elements.ready = vm.runInNewContext(app, context);
  elements.draws = draws;
  elements.tick = now => { elements.camera.currentTime = now / 1000; nextFrame(now); };
  return elements;
}
function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
async function run() {
  let e = harness(async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); });
  await e.ready;
  assert.match(e.status.textContent, /permission was denied/);
  assert.equal(e.start.disabled, false);

  let resolveCamera;
  e = harness(() => new Promise(resolve => { resolveCamera = resolve; }));
  const pendingCamera = e.ready;
  e.stop.events.click();
  const lateStream = fakeStream(); resolveCamera(lateStream);
  await pendingCamera;
  assert.equal(lateStream.track.stopped, true);
  assert.equal(e.camera.srcObject, null);

  const stream = fakeStream();
  e = harness(async () => stream, async () => { throw new Error('offline'); });
  await e.ready;
  assert.equal(stream.track.stopped, true);
  assert.match(e.status.textContent, /Could not load mouth tracking/);

  let resolveModel, closeCount = 0;
  const modelPending = new Promise(resolve => { resolveModel = resolve; });
  e = harness(async () => fakeStream(), async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: () => modelPending },
  }));
  const starting = e.ready;
  await new Promise(resolve => setImmediate(resolve));
  e.stop.events.click();
  resolveModel({ close() { closeCount++; } });
  await starting;
  assert.equal(closeCount, 1);
  assert.equal(e.start.hidden, false);

  const activeStream = fakeStream();
  let visibleFaces = [face, face.map(point => ({ x: point.x - .25, y: point.y }))];
  e = harness(async () => activeStream, async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async (_, options) => {
      assert.equal(options.numFaces, 8);
      return { close() { closeCount++; }, detectForVideo: () => ({ faceLandmarks: visibleFaces }) };
    } },
  }));
  await e.ready;
  assert.equal(e.start.hidden, true);
  Object.assign(e.camera, { readyState: 2, videoWidth: 1000, videoHeight: 1000 });
  e.tick(200); e.tick(260);
  assert.match(e.status.textContent, /2 mouths detected/);
  assert.equal(e.draws.length, 2, 'each detected mouth receives a zucchini');
  visibleFaces = [];
  e.draws.length = 0;
  e.tick(320);
  assert.equal(e.draws.length, 0, 'lost faces remove their particles');
  visibleFaces = [face];
  e.tick(380); e.tick(440);
  assert.match(e.status.textContent, /1 mouth detected/);
  assert.ok(e.draws.length > 0, 'newly detected mouths start receiving zucchini');
  e.stop.events.click();
  assert.equal(activeStream.track.stopped, true);
  assert.equal(e.camera.srcObject, null);
  assert.equal(closeCount, 2);
  console.log('Camera autostart, multi-mouth animation, geometry, collision, permission errors, cancellation and cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
