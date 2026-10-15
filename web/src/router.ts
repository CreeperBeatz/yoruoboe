/**
 * A small history-API router. Screens are pushed like Android activities: going back
 * (the app bar's arrow, the browser's back, an iOS edge swipe) pops to the screen below.
 */

import { useSyncExternalStore } from 'react'

/** Which way the last navigation went: a screen pushed, popped, or replaced in place. */
export type NavDir = 'forward' | 'back' | 'none'

export interface Location {
  path: string
  query: URLSearchParams
  dir: NavDir
}

const listeners = new Set<() => void>()
let current: Location = read('none')
let lastDepth = depth()

function read(dir: NavDir): Location {
  return { path: window.location.pathname, query: new URLSearchParams(window.location.search), dir }
}

function emit(dir: NavDir) {
  lastDepth = depth()
  current = read(dir)
  listeners.forEach((fn) => fn())
}

window.addEventListener('popstate', (e) => {
  const d = depth()
  // Safari's edge swipe has already animated the page; don't animate it twice.
  const swiped = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition
  emit(swiped ? 'none' : d < lastDepth ? 'back' : d > lastDepth ? 'forward' : 'none')
})

export function navigate(to: string, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return
  if (replace) window.history.replaceState({ depth: depth() }, '', to)
  else window.history.pushState({ depth: depth() + 1 }, '', to)
  emit(replace ? 'none' : 'forward')
}

function depth(): number {
  return (window.history.state && typeof window.history.state.depth === 'number' && window.history.state.depth) || 0
}

/** Back if there is somewhere in the app to go back to, otherwise to `fallback`. */
export function goBack(fallback = '/') {
  if (depth() > 0) window.history.back()
  else navigate(fallback, { replace: true })
}

export function useLocation(): Location {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}

/** Match `/deck/:id`-style patterns; returns the params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('/').filter(Boolean)
  const rest = p.length > 0 && p[p.length - 1] === '*'
  if (rest ? s.length < p.length - 1 : s.length !== p.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      params['*'] = s.slice(i).map(decodeURIComponent).join('/')
      return params
    }
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i])
    else if (p[i] !== s[i]) return null
  }
  return params
}
