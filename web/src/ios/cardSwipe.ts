/**
 * The card in the hand, as on Tinder: it follows the finger, says what letting go will
 * do (the answer and its interval, in its colour) more strongly the further it goes, and
 * flies off that way when let go past the line or flung; short of it, it springs back.
 * Answered with a button, it leaves the same way. The next card comes up in its place.
 *
 * The card frame reports the finger (public/card-frame.js, dragCard); this moves the
 * card (`.card-area`) and its label (`.swipe-badge`, `.swipe-tint`, ios.css).
 */

import { useMemo, useRef } from 'react'
import { reducedMotion } from '../ui/motion'

export type SwipeDir = 'Left' | 'Right' | 'Up' | 'Down'

export interface SwipeIntent {
  label: string
  /** A CSS colour for the label and the card's tint. */
  color: string
  /** 'leave': the card goes (an answer). 'stay': it springs back, and the action runs. */
  then: 'leave' | 'stay'
}

/** How far to drag (at 100% sensitivity) before letting go does something. */
const LINE = 110
/** Or how fast to fling it (px/ms), past a short way. */
const FLING = 0.55
const FLING_MIN = 36
/** When the next card hasn't come in this long, the card comes back regardless. */
const BACK_ANYWAY_MS = 1500

const dirOf = (dx: number, dy: number): SwipeDir =>
  Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'Right' : 'Left') : dy > 0 ? 'Down' : 'Up'

const at = (x: number, y: number) => `translate(${x}px, ${y}px) rotate(${x * 0.05}deg)`

export function useCardSwipe(intent: (dir: SwipeDir) => SwipeIntent | null, sensitivity: () => number) {
  const card = useRef<HTMLDivElement>(null)
  const badge = useRef<HTMLDivElement>(null)
  const tint = useRef<HTMLDivElement>(null)
  const intentRef = useRef(intent)
  intentRef.current = intent
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity

  return useMemo(() => {
    let away: Animation | null = null
    let backTimer = 0
    let pos = { x: 0, y: 0 }

    const line = () => (LINE * 100) / (sensitivityRef.current() || 100)

    const label = (it: SwipeIntent | null, progress: number) => {
      const b = badge.current
      const t = tint.current
      if (!b || !t) return
      if (it) {
        b.textContent = it.label
        b.style.color = it.color
        t.style.background = it.color
      }
      b.style.opacity = String(it ? Math.min(1, progress * 1.3) : 0)
      b.classList.toggle('armed', progress >= 1)
      t.style.opacity = String(it ? Math.min(1, progress) * 0.16 : 0)
    }

    const fadeLabel = () => {
      badge.current?.classList.remove('armed')
      for (const el of [badge.current, tint.current]) {
        if (!el) continue
        el.style.transition = 'opacity 0.2s'
        el.style.opacity = '0'
      }
    }

    /** Off the screen, from where it is, the way it was going. */
    const fly = (dir: SwipeDir) => {
      const el = card.current
      window.clearTimeout(backTimer)
      backTimer = window.setTimeout(arrive, BACK_ANYWAY_MS)
      if (!el || away) return
      if (reducedMotion() || !el.animate) {
        el.style.visibility = 'hidden'
        away = { cancel() {} } as Animation
        return
      }
      const w = window.innerWidth * 1.4
      const h = window.innerHeight * 1.2
      const { x, y } = pos
      const to =
        dir === 'Left' ? at(-w, y + 40) : dir === 'Right' ? at(w, y + 40) : dir === 'Up' ? at(x, -h) : at(x, h)
      away = el.animate([{ transform: at(x, y) }, { transform: to }], {
        duration: 300,
        easing: 'cubic-bezier(0.25, 0.4, 0.45, 1)',
        fill: 'forwards',
      })
      el.style.transform = ''
      pos = { x: 0, y: 0 }
      fadeLabel()
    }

    /** The next card, coming up from the pile where the last one was. */
    function arrive() {
      const el = card.current
      window.clearTimeout(backTimer)
      if (!el || !away) return
      const gone = away
      away = null
      el.style.visibility = ''
      if (reducedMotion() || !el.animate) return gone.cancel()
      void gone.finished.catch(() => {}).then(() => {
        if (away) return
        el.animate(
          [
            { transform: 'translateY(28px) scale(0.92)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 340, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.08)' },
        )
        gone.cancel()
      })
    }

    const springBack = () => {
      const el = card.current
      fadeLabel()
      if (!el) return
      const from = at(pos.x, pos.y)
      el.style.transform = ''
      pos = { x: 0, y: 0 }
      if (!reducedMotion() && el.animate)
        el.animate([{ transform: from }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' })
    }

    return {
      card,
      badge,
      tint,
      /** The finger moved: the card follows, and says what letting go would do. */
      drag(dx: number, dy: number) {
        const el = card.current
        if (!el || away) return
        const it = intentRef.current(dirOf(dx, dy))
        // Nothing that way: it gives a little, as if held.
        const k = it ? 1 : 0.25
        pos = { x: dx * k, y: dy * k }
        el.style.transform = at(pos.x, pos.y)
        for (const e of [badge.current, tint.current]) if (e) e.style.transition = 'none'
        label(it, it ? Math.hypot(dx, dy) / line() : 0)
      },
      /** Let go: the way it goes, if that does something; the caller then does it. */
      drop(dx: number, dy: number, vx: number, vy: number): SwipeDir | null {
        if (away) return null
        const dir = dirOf(dx, dy)
        const it = intentRef.current(dir)
        const speed = dir === 'Left' ? -vx : dir === 'Right' ? vx : dir === 'Up' ? -vy : vy
        const done = !!it && (Math.hypot(dx, dy) >= line() || (Math.hypot(dx, dy) > FLING_MIN && speed > FLING))
        if (done && it.then === 'leave') fly(dir)
        else springBack()
        return done ? dir : null
      },
      /** Answered another way (a button, a key): the card goes as that swipe would. */
      leave: fly,
      arrive,
    }
  }, [])
}
