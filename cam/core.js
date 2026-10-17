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
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    radius: Math.max(9, Math.hypot(left.x - right.x, left.y - right.y) * .25) };
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

const CamMath = { screenPoint, mouthTarget, moveParticle };
if (typeof module !== 'undefined') module.exports = CamMath;
