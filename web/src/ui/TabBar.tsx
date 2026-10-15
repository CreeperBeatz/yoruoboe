/**
 * The iOS tab bar, in place of AnkiDroid's drawer: a floating glass bar with the places
 * the drawer goes to, and a lens that slides to the one open. It stays put while
 * screens change, and slides away under a screen pushed over a tab.
 */

import { navigate } from '../router'
import { Icon, type IconName } from './icons'

const TABS: { icon: IconName; label: string; to: string }[] = [
  { icon: 'decks', label: 'Decks', to: '/' },
  { icon: 'search', label: 'Browse', to: '/browse' },
  { icon: 'stats', label: 'Statistics', to: '/page/graphs' },
  { icon: 'settings', label: 'Settings', to: '/settings' },
]

/** Statistics is Anki's page, pushed over the tabs with its own back button. */
const PUSHED = '/page/graphs'

export function TabBar({ path }: { path: string }) {
  const active = TABS.findIndex((t) => t.to === path && t.to !== PUSHED)
  const shown = active >= 0
  return (
    <nav
      className={`tab-bar${shown ? '' : ' away'}`}
      inert={!shown}
      style={{ '--tabs': TABS.length, '--active': Math.max(active, 0) } as React.CSSProperties}
    >
      <span className="tab-lens" aria-hidden />
      {TABS.map((t, i) => (
        <button
          key={t.to}
          className={i === active ? 'active' : undefined}
          aria-current={i === active ? 'page' : undefined}
          onClick={() => i !== active && navigate(t.to, { replace: t.to !== PUSHED })}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
