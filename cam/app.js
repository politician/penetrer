/* global CamMath */
'use strict';
(() => {
  const video = document.getElementById('camera');
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  const start = document.getElementById('start');
  const stop = document.getElementById('stop');
  const fullscreen = document.getElementById('fullscreen');
  const status = document.getElementById('status');
  const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  let stream = null, detector = null, frameId = 0, generation = 0;
  const MAX_FACES = 8;
  let running = false, particles = [], targets = [], nextTargetId = 0;
  let lastFrame = 0, lastDetection = 0, lastVideoTime = -1, spawnTime = 0;
  let width = 0, height = 0;

  function say(text) { if (status.textContent !== text) status.textContent = text; }
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = [];
    targets = [];
    lastVideoTime = -1;
  }

  function end(message = 'Camera stopped.') {
    generation++;
    running = false;
    cancelAnimationFrame(frameId);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    if (detector) detector.close();
    detector = null;
    particles = [];
    targets = [];
    ctx.clearRect(0, 0, width, height);
    start.hidden = false;
    stop.hidden = true;
    start.disabled = false;
    start.textContent = 'Start camera';
    say(message);
  }

  function spawn(targetId) {
    const side = Math.floor(Math.random() * 4);
    particles.push({
      targetId,
      x: side === 0 ? -70 : side === 1 ? width + 70 : Math.random() * width,
      y: side === 2 ? -70 : side === 3 ? height + 70 : Math.random() * height,
      speed: 210 + Math.random() * 170,
      size: .65 + Math.random() * .5, angle: 0, scale: 1,
    });
  }

  // A curved green vegetable with a stem, blossom and pale garden stripes.
  function drawZucchini(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.scale(p.size * p.scale, p.size * p.scale);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#183921';
    ctx.fillStyle = '#69a942';
    ctx.beginPath();
    ctx.moveTo(31, -6);
    ctx.bezierCurveTo(11, -16, -16, -20, -30, -10);
    ctx.bezierCurveTo(-44, 0, -32, 18, -16, 15);
    ctx.bezierCurveTo(4, 14, 17, 5, 31, 6);
    ctx.quadraticCurveTo(38, 0, 31, -6);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#b5d56b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-29, -4); ctx.quadraticCurveTo(-9, -10, 25, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-25, 7); ctx.quadraticCurveTo(-7, 9, 20, 3); ctx.stroke();
    ctx.fillStyle = '#427435';
    ctx.fillRect(-41, -4, 11, 6);
    ctx.fillStyle = '#e6c45c';
    ctx.beginPath(); ctx.arc(34, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - lastFrame) / 1000, .05);
    lastFrame = now;
    ctx.clearRect(0, 0, width, height);
    if (document.hidden) {
      targets = [];
      particles = [];
    } else {
      // Limit inference to ~20fps, and never process the same camera frame twice.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetection >= 50) {
        lastDetection = now;
        lastVideoTime = video.currentTime;
        try {
          const mouths = detector.detectForVideo(video, now).faceLandmarks.map(face =>
            CamMath.mouthTarget(face, video.videoWidth, video.videoHeight, width, height));
          const matched = CamMath.matchTargets(targets, mouths, nextTargetId);
          targets = matched.targets;
          nextTargetId = matched.nextId;
        } catch (_) {
          end('Mouth tracking stopped. Start the camera to retry.');
          return;
        }
        const activeIds = new Set(targets.filter(target => target.open).map(target => target.id));
        particles = particles.filter(p => activeIds.has(p.targetId));
        say(targets.length ? (activeIds.size
          ? `Garden incoming! ${activeIds.size} open ${activeIds.size === 1 ? 'mouth' : 'mouths'}.`
          : 'Open your mouth to invite the zucchini.') : 'Looking for faces — face the camera in good light.');
      }
      const openTargets = targets.filter(target => target.open);
      if (openTargets.length) {
        spawnTime += dt;
        // Give every mouth its own stream and budget so no one is starved.
        while (spawnTime >= .08) {
          for (const target of openTargets) {
            if (particles.filter(p => p.targetId === target.id).length < 32) spawn(target.id);
          }
          spawnTime -= .08;
        }
        spawnTime = Math.min(spawnTime, .08);
        const byId = new Map(targets.map(target => [target.id, target]));
        particles = particles.filter(p => {
          const target = byId.get(p.targetId);
          return target && CamMath.moveParticle(p, target, dt);
        });
        particles.forEach(drawZucchini);
      } else {
        spawnTime = 0;
      }
    }
    frameId = requestAnimationFrame(frame);
  }

  async function begin() {
    if (running || start.disabled) return;
    const session = ++generation;
    start.hidden = true;
    start.disabled = true;
    start.textContent = 'Starting…';
    stop.hidden = false;
    say('Allow camera access to begin.');
    try {
      if (!window.isSecureContext) throw new Error('Use HTTPS or localhost to access the camera.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera access.');
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (session !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (session === generation) end('The camera disconnected. Start again to reconnect.');
      }));
      video.srcObject = stream;
      await video.play();
      if (session !== generation) return;
      say('Loading mouth tracking…');
      const { FaceLandmarker, FilesetResolver } = await import(VISION_URL);
      if (session !== generation) return;
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      if (session !== generation) return;
      const loaded = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO', numFaces: MAX_FACES,
      });
      if (session !== generation) { loaded.close(); return; }
      detector = loaded;
      running = true;
      lastFrame = performance.now();
      lastDetection = 0;
      lastVideoTime = -1;
      spawnTime = 0;
      say('Looking for faces — face the camera in good light.');
      frameId = requestAnimationFrame(frame);
    } catch (error) {
      if (session !== generation) return;
      const messages = {
        NotAllowedError: 'Camera permission was denied. Allow camera access in your browser, then retry.',
        NotFoundError: 'No camera found. Connect a camera, then retry.',
        NotReadableError: 'Camera is busy. Close other apps using it, then retry.',
      };
      end(messages[error.name] || (stream ? 'Could not load mouth tracking. Check your connection and retry.' : error.message));
    }
  }
  start.addEventListener('click', begin);
  stop.addEventListener('click', () => end());
  fullscreen.hidden = !document.documentElement.requestFullscreen;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { say('Full screen is unavailable. The camera still fills this window.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => end());
  resize();
  begin();
})();

