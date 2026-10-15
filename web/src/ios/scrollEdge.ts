/**
 * iOS 27's scroll edge: when a screen's content scrolls under its floating bar, the bar
 * gets a backing so its title stays legible. Marks the screen (`data-scrolled`); the
 * look is in ios.css.
 */
export function installScrollEdge() {
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.classList.contains('screen-body')) return
      el.parentElement?.toggleAttribute('data-scrolled', el.scrollTop > 2)
    },
    { capture: true, passive: true },
  )
}
