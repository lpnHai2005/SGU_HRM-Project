import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './common/Icons'

export function StoreActionMenu({ storeName, isActive, onEditManager, onHistory, onToggleActive, onDelete }: {
  storeName: string
  isActive: boolean
  onEditManager: () => void
  onHistory: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(238, window.innerWidth - 24)
    const estimatedHeight = 170
    setPosition({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: rect.bottom + estimatedHeight + 12 > window.innerHeight ? Math.max(12, rect.top - estimatedHeight - 6) : rect.bottom + 6,
    })
  }
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const closeOnScroll = () => setOpen(false)
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', closeOnScroll)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', closeOnScroll)
    }
  }, [open])

  return <>
    <button ref={buttonRef} type="button" className="store-more-button" aria-label="Thao tác khác" title={'Thao tác khác: ' + storeName} aria-expanded={open} aria-haspopup="menu" onClick={() => { if (!open) placeMenu(); setOpen(value => !value) }}>{Icons.moreVertical}</button>
    {open && createPortal(<div ref={menuRef} className="store-action-popover" role="menu" style={position}>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onEditManager() }}>Thay đổi người phụ trách</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onHistory() }}>Xem lịch sử thay đổi</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onToggleActive() }}>{isActive ? 'Ngừng hoạt động' : 'Kích hoạt lại'}</button>
      <button type="button" role="menuitem" disabled={isActive} title={isActive ? 'Hãy ngừng hoạt động cửa hàng trước' : 'Yêu cầu mã cửa hàng và lý do xóa'} onClick={() => { setOpen(false); onDelete() }}>Xóa cửa hàng</button>
    </div>, document.body)}
  </>
}
