export const IDLE_LIMIT_MS = 30 * 60 * 1000
export const IDLE_WARNING_MS = 2 * 60 * 1000
export const IDLE_LOGOUT_FLAG = 'idle_logout'
export const IDLE_ACTIVITY_KEY = 'hrm_last_activity'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']
const WRITE_EVERY_MS = 1000

interface IdleOptions {
  limitMs?: number
  warnMs?: number
  now?: () => number
  store?: Pick<Storage, 'getItem' | 'setItem'>
}

// Gọi onIdle đúng một lần sau limitMs không thao tác, onWarning(true/false) khi vào/ra khoảng warnMs trước đó.
// Trả về hàm dừng theo dõi.
// Mốc thao tác nằm trong localStorage vì các tab dùng chung token: tab bỏ không không được đăng xuất tab đang làm.
export function watchIdle(
  target: EventTarget,
  onIdle: () => void,
  onWarning: (warn: boolean) => void,
  { limitMs = IDLE_LIMIT_MS, warnMs = IDLE_WARNING_MS, now = Date.now, store = localStorage }: IdleOptions = {},
) {
  // clearAuth xóa mốc này nên chỉ phiên mới mới thiếu; F5 hay mở lại trình duyệt vẫn giữ mốc cũ.
  if (store.getItem(IDLE_ACTIVITY_KEY) === null) store.setItem(IDLE_ACTIVITY_KEY, String(now()))

  let warned = false
  const setWarned = (warn: boolean) => {
    if (warn === warned) return
    warned = warn
    onWarning(warn)
  }
  const stop = () => {
    clearInterval(timer)
    ACTIVITY_EVENTS.forEach(name => target.removeEventListener(name, onActivity, { capture: true }))
    setWarned(false)
  }
  const expired = () => {
    const last = store.getItem(IDLE_ACTIVITY_KEY)
    // Mất mốc giữa chừng nghĩa là tab khác đã đăng xuất, token không còn.
    const idleFor = last === null ? Infinity : now() - Number(last)
    if (idleFor >= limitMs) {
      stop()
      onIdle()
      return true
    }
    setWarned(idleFor >= limitMs - warnMs)
    return false
  }
  // Kiểm tra trước khi ghi nhận: máy ngủ dậy, cú di chuột đầu tiên không được xóa khoảng thời gian đã trôi qua.
  const onActivity = () => {
    if (expired()) return
    if (now() - Number(store.getItem(IDLE_ACTIVITY_KEY)) >= WRITE_EVERY_MS) {
      store.setItem(IDLE_ACTIVITY_KEY, String(now()))
      setWarned(false)
    }
  }

  const timer = setInterval(expired, Math.min(warnMs, 30_000))
  // capture: sự kiện scroll không nổi bọt từ các vùng cuộn bên trong.
  ACTIVITY_EVENTS.forEach(name => target.addEventListener(name, onActivity, { capture: true, passive: true }))
  expired()
  return stop
}
