/**
 * A small history-API router. Screens are pushed like Android activities: going back
 * (the app bar's arrow, the browser's back, an iOS edge swipe) pops to the screen below.
 */

import { useSyncExternalStore } from 'react'

export interface Location {
  path: string
  query: URLSearchParams
}

const listeners = new Set<() => void>()
let current: Location = read()

function read(): Location {
  return { path: window.location.pathname, query: new URLSearchParams(window.location.search) }
}

function emit() {
  current = read()
  listeners.forEach((fn) => fn())
}

window.addEventListener('popstate', emit)

export function navigate(to: string, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return
  if (replace) window.history.replaceState({ depth: depth() }, '', to)
  else window.history.pushState({ depth: depth() + 1 }, '', to)
  emit()
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
