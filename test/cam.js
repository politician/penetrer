'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { screenPoint, mouthTarget, moveParticle } = require('../cam/core.js');

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

// Exercise browser lifecycle without a physical camera or network models.
const app = fs.readFileSync(path.join(__dirname, '../cam/app.js'), 'utf8')
  .replace('import(VISION_URL)', 'loadVision()');
function harness(getUserMedia, loadVision) {
  const elements = {};
  for (const id of ['camera', 'overlay', 'welcome', 'start', 'stop', 'fullscreen', 'status']) {
    elements[id] = { hidden: false, disabled: false, textContent: '', events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      getContext() { return { clearRect() {}, setTransform() {} }; },
      async play() {},
    };
  }
  const context = {
    document: { getElementById: id => elements[id], documentElement: {}, addEventListener() {} },
    window: { isSecureContext: true, innerWidth: 360, innerHeight: 640, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => 100 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, loadVision,
  };
  vm.runInNewContext(app, context);
  return elements;
}
function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
async function run() {
  let e = harness(async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); });
  await e.start.events.click();
  assert.match(e.status.textContent, /permission was denied/);
  assert.equal(e.start.disabled, false);

  let resolveCamera;
  e = harness(() => new Promise(resolve => { resolveCamera = resolve; }));
  const pendingCamera = e.start.events.click();
  e.stop.events.click();
  const lateStream = fakeStream(); resolveCamera(lateStream);
  await pendingCamera;
  assert.equal(lateStream.track.stopped, true);
  assert.equal(e.camera.srcObject, null);

  const stream = fakeStream();
  e = harness(async () => stream, async () => { throw new Error('offline'); });
  await e.start.events.click();
  assert.equal(stream.track.stopped, true);
  assert.match(e.status.textContent, /Could not load mouth tracking/);

  let resolveModel, closeCount = 0;
  const modelPending = new Promise(resolve => { resolveModel = resolve; });
  e = harness(async () => fakeStream(), async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: () => modelPending },
  }));
  const starting = e.start.events.click();
  await new Promise(resolve => setImmediate(resolve));
  e.stop.events.click();
  resolveModel({ close() { closeCount++; } });
  await starting;
  assert.equal(closeCount, 1);
  assert.equal(e.welcome.hidden, false);

  const activeStream = fakeStream();
  e = harness(async () => activeStream, async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async () => ({ close() { closeCount++; } }) },
  }));
  await e.start.events.click();
  assert.equal(e.welcome.hidden, true);
  e.stop.events.click();
  assert.equal(activeStream.track.stopped, true);
  assert.equal(e.camera.srcObject, null);
  assert.equal(closeCount, 2);
  console.log('Camera geometry, collision, permission errors, model failure, startup cancellation and cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
