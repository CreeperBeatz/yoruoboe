/** The app's Material pieces: app bar, popup menus, dialogs, snackbar, FAB. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

// ---- app bar ------------------------------------------------------------------------

export function AppBar({
  title,
  subtitle,
  nav,
  onNav,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  nav?: 'back' | 'menu' | 'close'
  onNav?: () => void
  children?: ReactNode
}) {
  return (
    <header className="app-bar">
      {nav && (
        <IconButton icon={nav === 'back' ? 'back' : nav === 'menu' ? 'menu' : 'close'} label={nav} onClick={onNav} />
      )}
      <div className="app-bar-title">
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {children}
    </header>
  )
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  dot,
  spin,
  style,
}: {
  icon: IconName
  label: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  dot?: boolean
  spin?: boolean
  style?: React.CSSProperties
}) {
  return (
    <button className="icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled} style={style}>
      <Icon name={icon} className={spin ? 'spinning' : undefined} />
      {dot && <span className="badge-dot" />}
    </button>
  )
}

// ---- popup menu ---------------------------------------------------------------------

export interface MenuEntry {
  label: string
  icon?: IconName
  onClick?: () => void
  disabled?: boolean
  checked?: boolean
  hidden?: boolean
  color?: string
  /** Opens this sub-list in place of the menu. */
  submenu?: MenuItem[]
}

export type MenuItem = MenuEntry | 'separator'

export function Menu({
  anchor,
  items,
  onClose,
}: {
  /** The element the menu drops from, or a point (for long-press menus). */
  anchor: HTMLElement | { x: number; y: number }
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 })
  const [sub, setSub] = useState<MenuItem[] | null>(null)
  const shown = (sub ?? items).filter((i) => i === 'separator' || !i.hidden)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect()
      left = r.right - w
      top = r.top + 4
    } else {
      left = anchor.x
      top = anchor.y
    }
    left = Math.max(8, Math.min(left, vw - w - 8))
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos({ left, top })
  }, [anchor, sub])

  return (
    <>
      <div className="scrim clear" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div className="menu" ref={ref} style={pos} role="menu">
        {shown.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              className="menu-item"
              role="menuitem"
              disabled={item.disabled}
              style={item.color ? { color: item.color } : undefined}
              onClick={() => {
                if (item.submenu) {
                  setSub(item.submenu)
                  return
                }
                onClose()
                item.onClick?.()
              }}
            >
              {item.icon && <Icon name={item.icon} style={item.color ? { fill: item.color } : undefined} />}
              <span>{item.label}</span>
              {item.checked && <Icon name="check" className="check" />}
              {item.submenu && <Icon name="chevronRight" className="check" />}
            </button>
          ),
        )}
      </div>
    </>
  )
}

/** A menu opened from a button: returns the button's onClick and the menu element. */
export function useMenu(items: () => MenuItem[]): [(e: React.MouseEvent<HTMLElement>) => void, ReactNode] {
  const [anchor, setAnchor] = useState<HTMLElement | { x: number; y: number } | null>(null)
  const open = (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)
  const el = anchor ? <Menu anchor={anchor} items={items()} onClose={() => setAnchor(null)} /> : null
  return [open, el]
}

// ---- dialogs ------------------------------------------------------------------------

export function Dialog({
  title,
  children,
  actions,
  onClose,
  wide,
}: {
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" style={wide ? { width: 'min(720px, calc(100vw - 24px))' } : undefined}>
        {title && <h2>{title}</h2>}
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </>
  )
}

// Imperative dialogs (confirm, prompt, choose), rendered by <DialogHost/>.

type Pending = { id: number; render: (close: () => void) => ReactNode }
let pendingSeq = 0
const dialogListeners = new Set<(d: Pending[]) => void>()
let dialogs: Pending[] = []

function pushDialog(render: Pending['render']) {
  const entry = { id: ++pendingSeq, render }
  dialogs = [...dialogs, entry]
  dialogListeners.forEach((fn) => fn(dialogs))
  return () => {
    dialogs = dialogs.filter((d) => d !== entry)
    dialogListeners.forEach((fn) => fn(dialogs))
  }
}

export function DialogHost() {
  const [list, setList] = useState(dialogs)
  useEffect(() => {
    dialogListeners.add(setList)
    return () => {
      dialogListeners.delete(setList)
    }
  }, [])
  return (
    <>
      {list.map((d) => {
        let close = () => {}
        close = () => {
          dialogs = dialogs.filter((x) => x !== d)
          dialogListeners.forEach((fn) => fn(dialogs))
        }
        return <div key={d.id}>{d.render(close)}</div>
      })}
    </>
  )
}

/** Show any dialog; `render` gets a `close` to call when done. */
export function showDialog(render: (close: () => void) => ReactNode): () => void {
  return pushDialog(render)
}

export function confirm(
  message: ReactNode,
  { title, ok = 'OK', cancel = 'Cancel', danger = false }: { title?: string; ok?: string; cancel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    pushDialog((close) => {
      const done = (v: boolean) => {
        close()
        resolve(v)
      }
      return (
        <Dialog
          title={title}
          onClose={() => done(false)}
          actions={
            <>
              <button className="text-btn" onClick={() => done(false)}>
                {cancel}
              </button>
              <button className={`text-btn${danger ? ' danger' : ''}`} onClick={() => done(true)} autoFocus>
                {ok}
              </button>
            </>
          }
        >
          {message}
        </Dialog>
      )
    })
  })
}

export function alertDialog(message: ReactNode, title?: string): Promise<void> {
  return new Promise((resolve) => {
    pushDialog((close) => (
      <Dialog
        title={title}
        onClose={() => (close(), resolve())}
        actions={
          <button className="text-btn" onClick={() => (close(), resolve())} autoFocus>
            OK
          </button>
        }
      >
        {message}
      </Dialog>
    ))
  })
}

function PromptDialog({
  title,
  label,
  initial,
  ok,
  inputMode,
  type,
  close,
  resolve,
  multiline,
}: {
  title: string
  label?: string
  initial: string
  ok: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  type?: string
  multiline?: boolean
  close: () => void
  resolve: (v: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])
  const done = (v: string | null) => {
    close()
    resolve(v)
  }
  return (
    <Dialog
      title={title}
      onClose={() => done(null)}
      actions={
        <>
          <button className="text-btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="text-btn" onClick={() => done(value)}>
            {ok}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          done(value)
        }}
      >
        <label className="field">
          {label && <span>{label}</span>}
          {multiline ? (
            <textarea ref={inputRef} rows={5} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input ref={inputRef} value={value} type={type} inputMode={inputMode} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>
      </form>
    </Dialog>
  )
}

export function prompt(
  title: string,
  {
    label,
    initial = '',
    ok = 'OK',
    inputMode,
    type,
    multiline,
  }: { label?: string; initial?: string; ok?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; type?: string; multiline?: boolean } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    pushDialog((close) => (
      <PromptDialog
        title={title}
        label={label}
        initial={initial}
        ok={ok}
        inputMode={inputMode}
        type={type}
        multiline={multiline}
        close={close}
        resolve={resolve}
      />
    ))
  })
}

/** A list to pick one entry from (Android's single-choice dialog). */
export function choose<T>(title: string, options: { label: ReactNode; value: T; checked?: boolean }[]): Promise<T | null> {
  return new Promise((resolve) => {
    pushDialog((close) => {
      const done = (v: T | null) => {
        close()
        resolve(v)
      }
      return (
        <Dialog
          title={title}
          onClose={() => done(null)}
          actions={
            <button className="text-btn" onClick={() => done(null)}>
              Cancel
            </button>
          }
        >
          <div style={{ margin: '0 -24px' }}>
            {options.map((o, i) => (
              <button key={i} className="menu-item" onClick={() => done(o.value)} style={{ paddingLeft: 24 }}>
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.checked && <Icon name="check" />}
              </button>
            ))}
          </div>
        </Dialog>
      )
    })
  })
}

// ---- snackbar -----------------------------------------------------------------------

interface Snack {
  id: number
  text: string
  action?: { label: string; run: () => void }
  ms: number
}

let snackSeq = 0
const snackListeners = new Set<(s: Snack | null) => void>()

export function toast(text: string, action?: { label: string; run: () => void }, ms = action ? 5000 : 2500) {
  const s = { id: ++snackSeq, text, action, ms }
  snackListeners.forEach((fn) => fn(s))
}

export function SnackbarHost() {
  const [snack, setSnack] = useState<Snack | null>(null)
  useEffect(() => {
    snackListeners.add(setSnack)
    return () => {
      snackListeners.delete(setSnack)
    }
  }, [])
  useEffect(() => {
    if (!snack) return
    const t = setTimeout(() => setSnack((s) => (s?.id === snack.id ? null : s)), snack.ms)
    return () => clearTimeout(t)
  }, [snack])
  if (!snack) return null
  return (
    <div className="snackbar" role="status">
      <span>{snack.text}</span>
      {snack.action && (
        <button
          className="text-btn"
          onClick={() => {
            snack.action?.run()
            setSnack(null)
          }}
        >
          {snack.action.label}
        </button>
      )}
    </div>
  )
}

/** Run an action, showing its error (if any) as a snackbar instead of throwing. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e))
    return undefined
  }
}

// ---- long press ---------------------------------------------------------------------

/**
 * Long-press (touch) and right-click (mouse) as one gesture, giving the press point.
 * Spread `handlers` on the element; `consumed()` says whether to ignore the click after.
 */
export function useLongPress(onLongPress: (p: { x: number; y: number }) => void, ms = 450) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const clear = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        if (navigator.vibrate) navigator.vibrate(20)
        onLongPress(start.current!)
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (!fired.current) onLongPress({ x: e.clientX, y: e.clientY })
    },
  }
  return {
    handlers,
    /** True if the click that follows a long press should be ignored. */
    consumed: () => {
      const f = fired.current
      fired.current = false
      return f
    },
  }
}
