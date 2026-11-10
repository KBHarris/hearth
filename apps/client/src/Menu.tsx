import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * A button that opens a short list of actions. Choosing an action, clicking away, Tab or Escape
 * closes it. Arrow keys move between actions, and focus returns to the button afterwards so a
 * dialog opened from the menu can hand focus back when it closes.
 */
export function Menu({ label, icon, children, placement = 'bottom-end', className = '', disabled = false }: {
  label: string; icon: ReactNode; children: ReactNode; placement?: 'bottom-end' | 'top-end' | 'top-start'; className?: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const items = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent | globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape, true) }
  }, [open])
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') { setOpen(false); return }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const all = items(), current = all.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (current + step + all.length) % all.length
    all[next]?.focus()
  }
  return <div ref={root} className={`menu ${className}`} data-open={open}>
    <button ref={trigger} type="button" className="icon-button menu-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(value => !value)}>{icon}</button>
    {open && <div ref={list} id={id} className="menu-list" role="menu" aria-label={label} data-placement={placement} onKeyDown={navigate}
      onClick={event => { if ((event.target as HTMLElement).closest('button')) { trigger.current?.focus(); setOpen(false) } }}>{children}</div>}
  </div>
}
