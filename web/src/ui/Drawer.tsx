/** AnkiDroid's navigation drawer: Decks, Card browser, Statistics, Settings, Help. */

import { useEffect } from 'react'
import type { Me } from '../api'
import { navigate, useLocation } from '../router'
import { Icon, type IconName } from './icons'
import './drawer.css'

export function Drawer({ me, onClose }: { me: Me; onClose: () => void }) {
  const loc = useLocation()
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

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
      <div className="scrim" onClick={onClose} />
      <nav className="drawer">
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
