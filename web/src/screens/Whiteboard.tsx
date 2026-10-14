/**
 * The whiteboard over the card (AnkiDroid's Whiteboard): draw with a finger or stylus,
 * undo strokes, erase, change pen colour and width, clear, save as an image.
 * Two fingers still scroll the card underneath (touch-action is per pointer count).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getPrefs, setPrefs } from '../prefs'
import { choose, IconButton, prompt } from '../ui/components'

export interface WhiteboardHandle {
  /** Undo the last stroke; false if there was none. */
  undo(): boolean
  clear(): void
}

type Stroke = { color: string; width: number; erase: boolean; points: [number, number][] }

const PEN_COLORS = ['', '#000000', '#ffffff', '#d32f2f', '#388e3c', '#1976d2', '#fbc02d']

export const Whiteboard = forwardRef<WhiteboardHandle, { onClose: () => void }>(function Whiteboard({ onClose }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const redoStack = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  const pointers = useRef(new Set<number>())
  const [erase, setErase] = useState(false)
  const [stylusOnly, setStylusOnly] = useState(false)
  const [, force] = useState(0)

  const penColor = () => {
    const chosen = getPrefs().whiteboardPenColor
    if (chosen) return chosen
    const dark = document.documentElement.dataset.theme === 'dark' || document.documentElement.dataset.theme === 'black'
    return dark ? '#ffffff' : '#000000'
  }

  const redraw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const dpr = window.devicePixelRatio || 1
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      if (s.points.length === 0) continue
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const [x0, y0] = s.points[0]
      ctx.moveTo(x0 * dpr, y0 * dpr)
      if (s.points.length === 1) ctx.lineTo(x0 * dpr + 0.1, y0 * dpr)
      for (let i = 1; i < s.points.length; i++) {
        const [x, y] = s.points[i]
        ctx.lineTo(x * dpr, y * dpr)
      }
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      c.width = c.clientWidth * dpr
      c.height = c.clientHeight * dpr
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    return () => ro.disconnect()
  }, [redraw])

  useImperativeHandle(ref, () => ({
    undo: () => {
      const s = strokes.current.pop()
      if (!s) return false
      redoStack.current.push(s)
      redraw()
      force((n) => n + 1)
      return true
    },
    clear: () => {
      strokes.current = []
      redoStack.current = []
      redraw()
      force((n) => n + 1)
    },
  }))

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const down = (e: React.PointerEvent) => {
    pointers.current.add(e.pointerId)
    if (pointers.current.size > 1) {
      // A second finger: it was a scroll, not a stroke.
      current.current = null
      redraw()
      return
    }
    if (stylusOnly && e.pointerType !== 'pen') return
    canvas.current!.setPointerCapture(e.pointerId)
    current.current = {
      color: penColor(),
      width: erase ? 30 : getPrefs().whiteboardStrokeWidth,
      erase,
      points: [pos(e)],
    }
    redraw()
  }
  const move = (e: React.PointerEvent) => {
    if (!current.current) return
    current.current.points.push(pos(e))
    redraw()
  }
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (!current.current) return
    strokes.current.push(current.current)
    redoStack.current = []
    current.current = null
    redraw()
    force((n) => n + 1)
  }

  const pickColor = async () => {
    const c = await choose(
      'Pen colour',
      PEN_COLORS.map((col) => ({
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="pen-swatch" style={{ background: col || 'linear-gradient(135deg,#000 50%,#fff 50%)' }} />
            {col ? col : 'Automatic (follows theme)'}
          </span>
        ),
        value: col,
        checked: getPrefs().whiteboardPenColor === col,
      })),
    )
    if (c !== null) setPrefs({ whiteboardPenColor: c })
  }

  const pickWidth = async () => {
    const w = await prompt('Stroke width', { initial: String(getPrefs().whiteboardStrokeWidth), inputMode: 'numeric' })
    const n = Number(w)
    if (n > 0 && n <= 100) setPrefs({ whiteboardStrokeWidth: n })
  }

  const save = () => {
    const c = canvas.current
    if (!c) return
    const a = document.createElement('a')
    a.download = `whiteboard-${Date.now()}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  }

  return (
    <div className="whiteboard">
      <canvas
        ref={canvas}
        style={{ touchAction: 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="whiteboard-tools">
        <IconButton icon="undo" label="Undo stroke" disabled={!strokes.current.length} onClick={() => {
          const s = strokes.current.pop()
          if (s) redoStack.current.push(s)
          redraw()
          force((n) => n + 1)
        }} />
        <IconButton icon="redo" label="Redo stroke" disabled={!redoStack.current.length} onClick={() => {
          const s = redoStack.current.pop()
          if (s) strokes.current.push(s)
          redraw()
          force((n) => n + 1)
        }} />
        <span className={erase ? 'icon-btn-wrap active' : 'icon-btn-wrap'}>
          <IconButton icon="close" label={erase ? 'Pen' : 'Eraser'} onClick={() => setErase(!erase)} style={erase ? { background: 'var(--ripple)' } : undefined} />
        </span>
        <IconButton icon="palette" label="Pen colour" onClick={pickColor} />
        <IconButton icon="brush" label="Stroke width" onClick={pickWidth} />
        <IconButton icon="edit" label={stylusOnly ? 'Stylus only: on' : 'Stylus only: off'} onClick={() => setStylusOnly(!stylusOnly)} style={stylusOnly ? { background: 'var(--ripple)' } : undefined} />
        <IconButton icon="download" label="Save as image" onClick={save} />
        <IconButton icon="delete" label="Clear" onClick={() => {
          strokes.current = []
          redoStack.current = []
          redraw()
          force((n) => n + 1)
        }} />
        <IconButton icon="eye" label="Hide whiteboard" onClick={onClose} />
      </div>
    </div>
  )
})
