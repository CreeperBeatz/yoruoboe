/** AnkiDroid's navigation drawer: Decks, Card browser, Statistics, Settings, Help. */

import { useEffect, useRef, useState } from 'react'
import type { Me } from '../api'
import { navigate, useLocation } from '../router'
import { Icon, type IconName } from './icons'
import { afterExit } from './motion'
import './drawer.css'

export function Drawer({ me, onClose: closed }: { me: Me; onClose: () => void }) {
  const loc = useLocation()
  const nav = useRef<HTMLElement>(null)
  const [closing, setClosing] = useState(false)
  // Slide out, then go.
  const onClose = () => {
    setClosing(true)
    afterExit(closed, 200)
  }
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // Swiped to the left, it follows the finger, and goes if let go past a third.
  useEffect(() => {
    const el = nav.current
    if (!el) return
    let start: { x: number; y: number } | null = null
    let dx = 0
    let dragging = false
    const down = (e: TouchEvent) => {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      dx = 0
      dragging = false
    }
    const move = (e: TouchEvent) => {
      if (!start) return
      const x = e.touches[0].clientX - start.x
      const y = e.touches[0].clientY - start.y
      if (!dragging && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) dragging = true
      if (!dragging) return
      dx = Math.min(0, x)
      el.style.transition = 'none'
      el.style.transform = `translateX(${dx}px)`
    }
    const up = () => {
      if (dragging && -dx > el.offsetWidth / 3) closeRef.current()
      else if (dragging) {
        el.style.transition = 'transform 0.2s var(--ease-standard)'
        el.style.transform = ''
      }
      start = null
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', up)
    el.addEventListener('touchcancel', up)
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', up)
      el.removeEventListener('touchcancel', up)
    }
  }, [])

  const item = (icon: IconName, label: string, to: string, active: boolean) => (
    <button
      className={`drawer-item${active ? ' active' : ''}`}
      onClick={() => {
        onClose()
        if (!active) navigate(to)
      }}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  )

  return (
    <>
      <div className={`scrim${closing ? ' closing' : ''}`} onClick={onClose} />
      <nav ref={nav} className={`drawer${closing ? ' closing' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-logo">
            <img src="/icon-192.png" alt="" />
          </div>
          <div className="drawer-user">{me.username}</div>
        </div>
        {item('decks', 'Decks', '/', loc.path === '/')}
        {item('search', 'Card browser', '/browse', loc.path === '/browse')}
        {item('stats', 'Statistics', '/page/graphs', loc.path.startsWith('/page/graphs'))}
        <div className="menu-sep" />
        {item('settings', 'Settings', '/settings', loc.path.startsWith('/settings'))}
        <button
          className="drawer-item"
          onClick={() => {
            onClose()
            window.open('https://docs.ankiweb.net/', '_blank', 'noopener')
          }}
        >
          <Icon name="help" />
          <span>Help</span>
        </button>
      </nav>
    </>
  )
}
