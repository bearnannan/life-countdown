import { useRef, useEffect } from 'react';
import './AdminBackground.css';

/**
 * React Bits AdminBackground Component
 * Provides a subtle, premium Cyber Grid + Aurora Glow background for administration panels.
 */
export default function AdminBackground({
  children,
  className = '',
  enableGlow = true,
  enableGrid = true,
  enableAurora = true,
  ...props
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enableGlow) return;

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

    const update = () => {
      currentX += (targetX - currentX) * 0.15;
      currentY += (targetY - currentY) * 0.15;

      container.style.setProperty('--mouse-x', `${currentX.toFixed(2)}%`);
      container.style.setProperty('--mouse-y', `${currentY.toFixed(2)}%`);

      if (isHovering || Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) {
        rafId = requestAnimationFrame(update);
      } else {
        rafId = null;
      }
    };

    const startLoop = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(update);
      }
    };

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [enableGlow]);

  return (
    <div
      ref={containerRef}
      className={`admin-background-wrapper ${className}`}
      {...props}
    >
      <div className="admin-background-layer" aria-hidden="true">
        {enableAurora && <div className="admin-bg-aurora" />}
        {enableGrid && <div className="admin-bg-grid" />}
        {enableGlow && <div className="admin-bg-glow" />}
        <div className="admin-bg-vignette" />
      </div>
      <div className="admin-background-content">{children}</div>
    </div>
  );
}
