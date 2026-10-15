/**
 * The card turning over to show its answer: a quarter turn away until it is edge-on, the
 * answer drawn while it can't be seen, and a quarter turn back with the answer up.
 * Reduce Motion: the answer just appears.
 */

import { reducedMotion } from '../ui/motion'

const AWAY_MS = 170
const BACK_MS = 320
/** Longest the card waits edge-on for the answer to be drawn. */
const DRAW_MS = 400

const turned = (deg: number, scale = 1) => ({ transform: `perspective(1600px) rotateY(${deg}deg) scale(${scale})` })
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

export interface Flip {
  /** Once the card is edge-on, `draw` the other side, then turn it face up. */
  turn(draw: () => Promise<unknown>): Promise<void>
  /** Not turning after all: back as it was. */
  cancel(): void
}

/** Start turning `el` over at once, while what goes on its back is fetched. */
export function startFlip(el: HTMLElement | null): Flip {
  if (!el?.animate || reducedMotion())
    return {
      turn: async (draw) => void (await draw()),
      cancel() {},
    }
  const away = el.animate([turned(0), turned(90, 0.96)], { duration: AWAY_MS, easing: 'cubic-bezier(0.45, 0, 1, 1)', fill: 'forwards' })
  return {
    async turn(draw) {
      await away.finished.catch(() => {})
      await Promise.race([draw(), wait(DRAW_MS)])
      // A touch past face-up and back, as a card set down.
      el.animate([turned(-90, 0.96), turned(4), turned(0)], { duration: BACK_MS, easing: 'cubic-bezier(0.15, 0.6, 0.35, 1)' })
      away.cancel()
    },
    cancel() {
      away.cancel()
    },
  }
}
