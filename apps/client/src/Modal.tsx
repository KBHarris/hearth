import { useEffect, useId, useRef, type ReactNode } from 'react'

/** Native dialogs keep keyboard focus inside the panel and restore it on close. */
export function Modal({ title, description, onClose, children }: {
  title: string; description?: string; onClose: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return <dialog ref={dialog} className="panel-dialog" aria-labelledby={id} aria-describedby={description ? `${id}-help` : undefined}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex]'))
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0)
      if (!controls.length) { event.preventDefault(); return }
      const index = controls.indexOf(document.activeElement as HTMLElement)
      if (index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault()
        controls[event.shiftKey ? controls.length - 1 : 0].focus()
      }
    }}
    onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="dialog-surface">
      <header className="panel-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}>×</button></header>
      {description && <p className="panel-description" id={`${id}-help`}>{description}</p>}
      <div className="panel-body">{children}</div>
    </div>
  </dialog>
}
