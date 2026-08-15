/**
 * SpotlightCard Engine (Vanilla JS / ES Module)
 * Port of React Bits <SpotlightCard /> component.
 * Provides dynamic cursor-following spotlight glow effect across cards and panels.
 */

export function attachSpotlight(element, options = {}) {
  if (!element || element._spotlightAttached) return;
  element._spotlightAttached = true;
  element.classList.add('spotlight-card');

  const defaultColor = options.color || element.dataset.spotlightColor || 'rgba(56, 189, 248, 0.15)';
  element.style.setProperty('--spotlight-color', defaultColor);

  const onPointerMove = (e) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    element.style.setProperty('--mouse-x', `${x}px`);
    element.style.setProperty('--mouse-y', `${y}px`);
  };

  element.addEventListener('pointermove', onPointerMove, { passive: true });
}

export function initSpotlightCards(selector = '.spotlight-card, .kpi-card, .notif-card, .panel', options = {}) {
  const cards = document.querySelectorAll(selector);
  cards.forEach((card) => {
    attachSpotlight(card, options);
  });
}
