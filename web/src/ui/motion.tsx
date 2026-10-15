/**
 * Movement: screens sliding over each other as AnkiDroid's activities do, and the
 * Material ripple on what can be tapped. Both stand down for the system's Reduce Motion.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { NavDir } from '../router'
import './motion.css'

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

export function reducedMotion(): boolean {
  return reduce.matches
}

/** How long a screen takes to slide in or out (motion.css, --route-ms). */
const ROUTE_MS = 340

/**
 * The current screen, and for a moment the one it replaces: a pushed screen slides in
 * from the right over the old one, a popped one slides away to the right to show the
 * screen below. A screen replaced in place fades in.
 */
export function RouteTransition({ routeKey, dir, children }: { routeKey: string; dir: NavDir; children: ReactNode }) {
  const [cur, setCur] = useState({ key: routeKey, dir: 'none' as NavDir, first: true })
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode; dir: NavDir } | null>(null)
  const lastNode = useRef(children)

  if (cur.key !== routeKey) {
    // Keep the old screen's last rendering on the page while it moves away.
    const animate = dir !== 'none' && !reducedMotion()
    setLeaving(animate ? { key: cur.key, node: lastNode.current, dir } : null)
    setCur({ key: routeKey, dir, first: false })
  }

  useLayoutEffect(() => {
    lastNode.current = children
  })

  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => setLeaving(null), ROUTE_MS + 40)
    return () => window.clearTimeout(t)
  }, [leaving])

  const enter = cur.first ? '' : ` route-enter-${cur.dir}`
  return [
    leaving && (
      <div key={leaving.key} className={`route route-exit-${leaving.dir}`} inert aria-hidden>
        {leaving.node}
      </div>
    ),
    <div key={cur.key} className={`route${enter}`}>
      {children}
    </div>,
  ]
}

// ---- ripple -----------------------------------------------------------------------------

/** What gets a ripple when pressed (and `position: relative; overflow: hidden`, in motion.css). */
const RIPPLE =
  '.icon-btn, .menu-item, .text-btn, .btn, .deck-name, .deck-counts, .ease-btn, .show-answer, .fab, .drawer-item, ' +
  '.settings-row:not(.static), .browser-row, .list-row, .tab, .bottom-tabs button, .ripple-host'

/** Material's touch ripple, from where the finger went down, for every element in RIPPLE. */
export function installRipple() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reducedMotion() || e.button !== 0) return
      const host = (e.target as Element | null)?.closest?.(RIPPLE) as HTMLElement | null
      if (!host || (host as HTMLButtonElement).disabled) return
      const r = host.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      // Big enough to cover the element from the touch point.
      const size = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y))
      const wave = document.createElement('span')
      wave.className = 'ripple'
      wave.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px`
      host.appendChild(wave)
      const release = () => {
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
        // Let the wave finish growing before it fades.
        const grown = Number(wave.dataset.start) + 220 - performance.now()
        window.setTimeout(() => {
          wave.classList.add('out')
          window.setTimeout(() => wave.remove(), 350)
        }, Math.max(0, grown))
      }
      wave.dataset.start = String(performance.now())
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    },
    { passive: true, capture: true },
  )
}

/** Run `fn` once an element's exit animation has had time to play. */
export function afterExit(fn: () => void, ms: number) {
  if (reducedMotion()) fn()
  else window.setTimeout(fn, ms)
}
