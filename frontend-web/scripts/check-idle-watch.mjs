// Kiểm tra tự đăng xuất khi không hoạt động: node scripts/check-idle-watch.mjs
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { IDLE_ACTIVITY_KEY, watchIdle } from '../src/utils/idleWatch.ts'

const LIMIT = 60_000
const WARN = 10_000
const fakeStore = () => {
  const data = new Map()
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  }
}
const setup = (store = fakeStore(), clock = { time: 0 }, limitMs = LIMIT, warnMs = WARN) => {
  const target = new EventTarget()
  const state = { idle: 0, warnings: [] }
  const stop = watchIdle(target, () => { state.idle += 1 }, warn => state.warnings.push(warn), {
    limitMs, warnMs, now: () => clock.time, store,
  })
  const act = at => { clock.time = at; target.dispatchEvent(new Event('pointermove')) }
  return { state, stop, act, store, clock }
}

{
  // Thao tác trước hạn thì tính lại từ đầu, chưa tới khoảng cảnh báo thì không cảnh báo
  const { state, stop, act } = setup()
  act(45_000)
  act(90_000)
  assert.equal(state.idle, 0)
  assert.deepEqual(state.warnings, [])
  stop()
}

{
  // Máy ngủ dậy: thao tác đầu tiên sau hạn vẫn đăng xuất, và chỉ gọi một lần
  const { state, act } = setup()
  act(500_000)
  act(500_001)
  assert.equal(state.idle, 1)
}

{
  // Đã dừng theo dõi thì không gọi nữa
  const { state, stop, act } = setup()
  stop()
  act(500_000)
  assert.equal(state.idle, 0)
  assert.deepEqual(state.warnings, [])
}

{
  // Tab này bỏ không nhưng tab kia đang làm thì chưa hết hạn
  const idleTab = setup()
  const busyTab = setup(idleTab.store, idleTab.clock)
  busyTab.act(45_000)
  busyTab.act(90_000)
  idleTab.act(90_001)
  assert.equal(idleTab.state.idle, 0)
  idleTab.stop()
  busyTab.stop()
}

{
  // Tab khác đã đăng xuất (mốc bị xóa) thì tab này đăng xuất theo
  const { state, act, store } = setup()
  store.removeItem(IDLE_ACTIVITY_KEY)
  act(1)
  assert.equal(state.idle, 1)
}

{
  // Mở lại khi mốc cũ đã quá hạn: đăng xuất ngay. Phiên mới chưa có mốc thì không.
  const store = fakeStore()
  store.setItem(IDLE_ACTIVITY_KEY, '0')
  const stale = setup(store, { time: 500_000 })
  assert.equal(stale.state.idle, 1)

  const fresh = setup(fakeStore(), { time: 500_000 })
  assert.equal(fresh.state.idle, 0)
  fresh.stop()
}

{
  // Thao tác trong khoảng cảnh báo thì gỡ cảnh báo và tính lại từ đầu
  const { state, stop, act } = setup()
  act(55_000)
  assert.deepEqual(state.warnings, [true, false])
  assert.equal(state.idle, 0)
  stop()
}

{
  // Dừng theo dõi khi đang cảnh báo thì gỡ cảnh báo
  const store = fakeStore()
  store.setItem(IDLE_ACTIVITY_KEY, '0')
  const { state, stop } = setup(store, { time: 55_000 })
  assert.deepEqual(state.warnings, [true])
  stop()
  assert.deepEqual(state.warnings, [true, false])
}

{
  // Không có thao tác nào: bộ đếm tự cảnh báo, tab khác thao tác thì gỡ, rồi tự đăng xuất
  const { state, store, clock } = setup(fakeStore(), { time: 0 }, 1000, 20)
  clock.time = 990
  await sleep(60)
  assert.deepEqual(state.warnings, [true])

  store.setItem(IDLE_ACTIVITY_KEY, '990')
  await sleep(60)
  assert.deepEqual(state.warnings, [true, false])

  clock.time = 5000
  await sleep(60)
  assert.equal(state.idle, 1)
}

console.log('check-idle-watch: OK')
