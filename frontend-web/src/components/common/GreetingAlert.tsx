import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './Icons'
import './GreetingAlert.css'

export interface GreetingAlertProps {
  user?: {
    full_name?: string
    name?: string
    username?: string
  } | null
  onClose?: () => void
}

export function GreetingAlert({ user, onClose }: GreetingAlertProps) {
  // 1. Chỉ xuất hiện lần đầu khi đăng nhập vào trang thành công, không hiện lại mỗi lần vào Trang chủ
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return false
    const shown = sessionStorage.getItem('greeting_shown')
    return !shown
  })

  const [isClosing, setIsClosing] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const bannerRef = useRef<HTMLDivElement | null>(null)
  const dragStartX = useRef<number | null>(null)
  const currentDragOffset = useRef(0)

  useEffect(() => {
    if (visible) {
      sessionStorage.setItem('greeting_shown', 'true')
    }
  }, [visible])

  // Live clock
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [visible])

  // Kích hoạt đóng và chạy animation ngược vào trong sang mép phải
  const handleDismiss = () => {
    if (isClosing) return
    setIsClosing(true)
    setTimeout(() => {
      setVisible(false)
      if (onClose) onClose()
    }, 350)
  }

  // 2. Time-out alert này là 5s nếu người dùng không tự thao tác
  useEffect(() => {
    if (!visible || isClosing || isDragging) return
    const autoDismissTimer = setTimeout(() => {
      handleDismiss()
    }, 5000)
    return () => clearTimeout(autoDismissTimer)
  }, [visible, isClosing, isDragging])

  // Bấm ngoài thẻ thông báo để đóng (thông báo chạy ngược vào trong)
  useEffect(() => {
    if (!visible || isClosing) return

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (bannerRef.current && !bannerRef.current.contains(e.target as Node)) {
        handleDismiss()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDownOutside)
    }, 150)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [visible, isClosing])

  // Kéo vào bên phải để tắt
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.greeting-alert-close')) return
    dragStartX.current = e.clientX
    setIsDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const diff = e.clientX - dragStartX.current
    if (diff > 0) {
      currentDragOffset.current = diff
      setDragOffset(diff)
    } else {
      currentDragOffset.current = 0
      setDragOffset(0)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const diff = currentDragOffset.current
    dragStartX.current = null
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    if (diff > 55) {
      handleDismiss()
    } else {
      currentDragOffset.current = 0
      setDragOffset(0)
    }
  }

  if (!visible) return null

  const displayName = user?.full_name || user?.name || user?.username || 'bạn'
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = now.getFullYear()
  const timeSubtext = `Hôm nay: ${hours}:${minutes} | ${day}/${month}/${year}`

  const bannerContent = (
    <div
      ref={bannerRef}
      className={`greeting-alert-banner ${isClosing ? 'greeting-slide-out' : ''} ${isDragging ? 'greeting-dragging' : ''}`}
      style={dragOffset > 0 && !isClosing ? { transform: `translateX(${dragOffset}px)` } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="alert"
      aria-live="polite"
    >
      {/* Icon huy hiệu dạng span thân thiện (mặt trời buổi sáng năng lượng) */}
      <span className="greeting-icon-badge" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>

      <div className="greeting-alert-content">
        <div className="greeting-alert-title">
          Chào ngày mới, <strong>{displayName}</strong>! Chúc bạn một ngày làm việc tràn đầy năng lượng.
        </div>
        <div className="greeting-alert-subtext">
          {timeSubtext}
        </div>
      </div>

      <button
        type="button"
        className="greeting-alert-close"
        onClick={handleDismiss}
        aria-label="Đóng thông báo"
        title="Đóng thông báo"
      >
        <span className="greeting-close-icon">{Icons.x}</span>
      </button>
    </div>
  )

  // Portal trực tiếp ra document.body để luôn nằm trên cùng (z-index cao hơn class="topbar")
  return typeof document !== 'undefined' ? createPortal(bannerContent, document.body) : null
}
