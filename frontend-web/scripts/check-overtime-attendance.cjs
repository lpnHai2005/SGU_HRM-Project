// Browser E2E through the real Employee, Attendance and OT reconciliation APIs.
// Test clock and synthetic schedule are provided only by the loopback fixture server.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

const app = 'http://127.0.0.1:3174'
const api = 'http://127.0.0.1:55993'
const password = 'OT9-local-synthetic-only!'

async function fixture(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

async function login(browser, role, testTime) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.clock.install({ time: new Date(testTime) })
  await page.goto(`${app}/login`)
  await page.getByLabel('Tài khoản nhân sự').fill(`ot9_${role}`)
  await page.getByLabel('Mật khẩu xác thực').fill(password)
  const response = page.waitForResponse(r =>
    r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Đăng nhập Cổng Doanh nghiệp' }).click()
  assert.equal((await response).status(), 200, `login ${role}`)
  return { context, page }
}

async function createSelfRequest(page, day, runId) {
  await page.goto(`${app}/my-overtime`)
  await page.getByRole('button', { name: 'Đăng ký tăng ca', exact: true }).click()
  const modal = page.getByRole('heading', { name: 'Đăng Ký Làm Thêm Giờ (OT)' })
    .locator('xpath=ancestor::div[contains(@class,"card")][1]')
  await modal.locator('input[type="date"]').fill(day)
  await modal.locator('textarea').fill(`Synthetic real Attendance browser E2E ${runId}`)
  const response = page.waitForResponse(r =>
    r.url().endsWith('/api/v1/overtime-requests') && r.request().method() === 'POST')
  await modal.getByRole('button', { name: 'Gửi đăng ký OT' }).click()
  const created = await response
  assert.equal(created.status(), 201, await created.text())
  const requestId = (await created.json()).request_id
  await page.getByText('Đã nộp đơn đăng ký tăng ca thành công!').waitFor()
  return requestId
}

async function waitUntilEnabled(locator, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await locator.isEnabled()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${label} did not become enabled`)
}

async function main() {
  const health = await (await fetch(`${api}/fixture/health`)).json()
  assert.deepEqual(health, { database: 'ot_cutover02_m9_full_e2e', policy: 'DISABLED' })
  const fixtureSchedule = await fixture('/fixture/attendance-e2e/prepare', {})
  const day = fixtureSchedule.work_date
  const startTime = `${day}T17:59:00+07:00`
  const endTime = `${day}T20:00:00+07:00`
  const runId = randomUUID()
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let employee
  let hr
  try {
    await fixture('/fixture/test-clock', { value: startTime })
    employee = await login(browser, 'outsider', startTime)
    await employee.page.goto(`${app}/my-leave`)
    assert.equal(await employee.page.getByRole('button', {
      name: 'Đăng ký OT', exact: true,
    }).count(), 0, 'Leave page must not contain the separate OT module tab')
    const requestId = await createSelfRequest(employee.page, day, runId)
    console.log(`PASS BROWSER-ATT-01: Employee UI submitted OT request=${requestId}`)

    await employee.page.goto(`${app}/my-leave?tab=overtime&request_id=${requestId}`)
    await employee.page.waitForURL(`**/my-overtime?request_id=${requestId}`)
    const employeeDrawer = employee.page.locator('.overtime-detail-drawer')
    await employeeDrawer.waitFor()
    await employeeDrawer.getByText(`Đơn OT #${requestId}`).waitFor()
    console.log('PASS BROWSER-ATT-LEGACY: old leave OT deep link redirects to the dedicated OT page')

    hr = await login(browser, 'hr', startTime)
    await hr.page.goto(`${app}/leave?tab=overtime&request_id=${requestId}`)
    await hr.page.waitForURL(`**/overtime?request_id=${requestId}`)
    const drawer = hr.page.locator('.overtime-detail-drawer')
    await drawer.waitFor()
    await drawer.getByText(`Đơn OT #${requestId}`).waitFor()
    const approvedResponse = hr.page.waitForResponse(r =>
      r.url().endsWith(`/api/v1/overtime-requests/${requestId}/approve`)
        && r.request().method() === 'POST')
    hr.page.once('dialog', dialog => dialog.accept())
    await drawer.getByRole('button', { name: 'Phê duyệt OT (HR)', exact: true }).click()
    assert.equal((await approvedResponse).status(), 200)
    console.log('PASS BROWSER-ATT-02: HR UI approved the request through the real API')

    await employee.page.goto(`${app}/`)
    const checkIn = employee.page.getByRole('button', { name: 'Check-in', exact: true })
    await waitUntilEnabled(checkIn, 'Attendance check-in')
    const checkInResponse = employee.page.waitForResponse(r =>
      r.url().endsWith('/api/v1/attendances/check-in') && r.request().method() === 'POST')
    await checkIn.click()
    const started = await checkInResponse
    assert.equal(started.status(), 201, await started.text())
    const attendanceId = (await started.json()).attendance_id
    console.log(`PASS BROWSER-ATT-03: Employee UI check-in via Attendance API attendance=${attendanceId}`)

    await fixture('/fixture/test-clock', { value: endTime })
    await employee.page.clock.setFixedTime(new Date(endTime))
    await employee.page.reload()
    const checkOut = employee.page.getByRole('button', { name: 'Check-out', exact: true })
    await waitUntilEnabled(checkOut, 'Attendance check-out')
    const checkOutResponse = employee.page.waitForResponse(r =>
      r.url().endsWith('/api/v1/attendances/check-out') && r.request().method() === 'POST')
    await checkOut.click()
    const closed = await checkOutResponse
    assert.equal(closed.status(), 200, await closed.text())
    const attendanceResult = await closed.json()
    assert.equal(attendanceResult.attendance_id, attendanceId)
    assert.equal(attendanceResult.actual_work_hours, 2.02)
    console.log('PASS BROWSER-ATT-04: Employee UI check-out via Attendance API; actual session 2.02h')

    await hr.page.clock.setFixedTime(new Date(endTime))
    await hr.page.goto(`${app}/overtime?request_id=${requestId}`)
    const section = hr.page.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    const previewResponse = hr.page.waitForResponse(r =>
      r.url().endsWith(`/api/v1/overtime-reconciliations/${requestId}/preview`)
        && r.request().method() === 'POST')
    await section.getByRole('button', { name: 'Xem trước đối soát' }).click()
    const preview = await previewResponse
    assert.equal(preview.status(), 200, await preview.text())
    assert.equal((await preview.json()).proposed_microseconds, 7_200_000_000)

    const verifyResponse = hr.page.waitForResponse(r =>
      r.url().endsWith(`/api/v1/overtime-reconciliations/${requestId}/verify`)
        && r.request().method() === 'POST')
    await section.getByRole('button', { name: 'Xác minh OT' }).click()
    assert.equal((await verifyResponse).status(), 200)
    await section.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()

    const state = await (await fetch(`${api}/fixture/state/${requestId}`)).json()
    assert.equal(state.reconciliation.status, 'VERIFIED')
    assert.equal(state.reconciliation.verified_microseconds, 7_200_000_000)
    console.log('PASS BROWSER-ATT-05: HR UI preview/verify; API and DB state VERIFIED exactly 2h')

    await employee.page.setViewportSize({ width: 360, height: 800 })
    await employee.page.goto(`${app}/my-overtime?request_id=${requestId}`)
    const employeeSection = employee.page.getByRole('region', {
      name: 'Đối soát giờ OT thực tế',
    })
    await employeeSection.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    assert.equal(await employeeSection.getByRole('button', {
      name: 'Xác minh OT',
    }).count(), 0)
    const reload = employeeSection.getByRole('button', { name: 'Tải lại' })
    const detailReload = employee.page.waitForResponse(r =>
      r.url().endsWith(`/api/v1/overtime-reconciliations/${requestId}`)
        && r.request().method() === 'GET')
    await reload.click()
    assert.equal((await detailReload).status(), 200)
    await employeeSection.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    console.log('PASS BROWSER-ATT-06: Employee deep link, refresh, read-only result at 360px')
  } finally {
    await fixture('/fixture/test-clock', { value: null }).catch(() => {})
    await employee?.context.close()
    await hr?.context.close()
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
