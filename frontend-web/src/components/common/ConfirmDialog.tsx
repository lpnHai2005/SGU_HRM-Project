import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Request = { message: string; resolve: (ok: boolean) => void }

let show: ((request: Request) => void) | null = null

/** Thay cho window.confirm: cùng cách dùng, nhưng hiển thị bằng modal của hệ thống. */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise(resolve => {
    if (show) show({ message, resolve })
    else resolve(window.confirm(message))
  })
}

export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null)

  useEffect(() => {
    show = setRequest
    return () => { show = null }
  }, [])

  const close = (ok: boolean) => {
    request?.resolve(ok)
    setRequest(null)
  }

  useEffect(() => {
    if (!request) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      request.resolve(false)
      setRequest(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [request])

  if (!request) return null
  return createPortal(
    // Có thể mở trên một modal khác nên phải luôn nằm trên cùng.
    <div className="modal-overlay no-print" style={{ zIndex: 10000 }} onMouseDown={event => { if (event.target === event.currentTarget) close(false) }}>
      <div className="modal" style={{ maxWidth: 440 }} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div className="modal-header">
          <h3 className="modal-title" id="confirm-dialog-title">Xác nhận thao tác</h3>
        </div>
        <div className="modal-body">
          <p id="confirm-dialog-message" style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--text-secondary)' }}>{request.message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>Hủy</button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => close(true)}>Xác nhận</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
