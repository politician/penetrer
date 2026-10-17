'use strict';
// Match object-fit: cover and the mirrored video, including portrait crops.
function screenPoint(point, videoW, videoH, width, height) {
  const scale = Math.max(width / videoW, height / videoH);
  return {
    x: width - (point.x * videoW * scale + (width - videoW * scale) / 2),
    y: point.y * videoH * scale + (height - videoH * scale) / 2,
  };
}

function mouthTarget(landmarks, videoW, videoH, width, height) {
  const a = screenPoint(landmarks[13], videoW, videoH, width, height);
  const b = screenPoint(landmarks[14], videoW, videoH, width, height);
  const left = screenPoint(landmarks[61], videoW, videoH, width, height);
  const right = screenPoint(landmarks[291], videoW, videoH, width, height);
  const mouthWidth = Math.hypot(left.x - right.x, left.y - right.y);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    radius: Math.max(9, mouthWidth * .25),
    openness: mouthWidth > 0 ? Math.hypot(a.x - b.x, a.y - b.y) / mouthWidth : 0 };
}

// Swept arrival check prevents fast particles stepping past the mouth.
function moveParticle(particle, target, dt) {
  const dx = target.x - particle.x, dy = target.y - particle.y;
  const distance = Math.hypot(dx, dy);
  const step = particle.speed * Math.min(Math.max(dt, 0), .05);
  if (distance <= target.radius + step) return false;
  particle.x += dx / distance * step;
  particle.y += dy / distance * step;
  particle.angle = Math.atan2(dy, dx);
  particle.scale = Math.min(1, distance / 120);
  return true;
}

// Once released, a zucchini keeps falling even if the mouth reopens.
function updateParticle(particle, target, dt, viewportHeight) {
  if (!particle.falling && target?.open) return moveParticle(particle, target, dt);
  const delta = Math.min(Math.max(dt, 0), .05);
  if (!particle.falling) {
    particle.falling = true;
    particle.vx = Math.cos(particle.angle) * particle.speed;
    particle.vy = Math.sin(particle.angle) * particle.speed;
    particle.spin = particle.vx >= 0 ? 2 : -2;
  }
  const gravity = 1100;
  particle.x += particle.vx * delta;
  particle.y += particle.vy * delta + .5 * gravity * delta * delta;
  particle.vy += gravity * delta;
  particle.angle += particle.spin * delta;
  return particle.y <= viewportHeight + 100 || particle.vy < 0;
}

// Face detection order can change between frames. Match nearby mouths one to
// one so existing particles keep following the same person when that happens.
function matchTargets(previous, mouths, nextId) {
  const pairs = [];
  previous.forEach(old => mouths.forEach((mouth, index) => {
    const distance = Math.hypot(old.x - mouth.x, old.y - mouth.y);
    if (distance <= Math.max(120, old.radius * 6)) pairs.push({ old, index, distance });
  }));
  pairs.sort((a, b) => a.distance - b.distance);
  const used = new Set(), matched = new Map();
  for (const { old, index } of pairs) {
    if (used.has(old.id) || matched.has(index)) continue;
    used.add(old.id);
    matched.set(index, old);
  }
  const targets = mouths.map((mouth, index) => ({
    ...mouth, id: matched.get(index)?.id ?? nextId++,
    // Two thresholds avoid flickering when lips hover near the open boundary.
    open: mouth.openness >= (matched.get(index)?.open ? .12 : .18),
  }));
  return { targets, nextId };
}

const CamMath = { screenPoint, mouthTarget, moveParticle, updateParticle, matchTargets };
if (typeof module !== 'undefined') module.exports = CamMath;

