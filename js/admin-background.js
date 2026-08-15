/**
 * React Bits Admin Background Engine
 * Handles mouse tracking and ambient lighting for #adminControls container.
 */

export function attachAdminBackground(container) {
  if (!container) return null;

  // Ensure background structure exists
  let bg = container.querySelector('.admin-controls__bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'admin-controls__bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = `
      <div class="admin-bg-aurora"></div>
      <div class="admin-bg-grid"></div>
      <div class="admin-bg-glow"></div>
      <div class="admin-bg-vignette"></div>
    `;
    container.insertBefore(bg, container.firstChild);
  }

  let rafId = null;
  let targetX = 50;
  let targetY = 30;
  let currentX = 50;
  let currentY = 30;
  let isHovering = false;

  const onPointerMove = (e) => {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    targetX = ((e.clientX - rect.left) / rect.width) * 100;
    targetY = ((e.clientY - rect.top) / rect.height) * 100;

    if (!isHovering) {
      isHovering = true;
      startLoop();
    }
  };

  const onPointerLeave = () => {
    isHovering = false;
  };

  function update() {
    currentX += (targetX - currentX) * 0.15;
    currentY += (targetY - currentY) * 0.15;

    container.style.setProperty('--mouse-x', `${currentX.toFixed(2)}%`);
    container.style.setProperty('--mouse-y', `${currentY.toFixed(2)}%`);

    if (isHovering || Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) {
      rafId = requestAnimationFrame(update);
    } else {
      rafId = null;
    }
  }

  function startLoop() {
    if (!rafId) {
      rafId = requestAnimationFrame(update);
    }
  }

  container.addEventListener('pointermove', onPointerMove, { passive: true });
  container.addEventListener('pointerleave', onPointerLeave, { passive: true });

  return {
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
    }
  };
}

export function initAdminBackgrounds(selector = '#adminControls, .admin-controls') {
  const elements = document.querySelectorAll(selector);
  elements.forEach((el) => {
    attachAdminBackground(el);
  });
}
