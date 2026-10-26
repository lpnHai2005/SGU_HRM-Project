// Real browser login and OT API acceptance. No OT/auth API interception or mocks.
// Attendance clock is a dedicated synthetic fixture because the OT date is future.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

const app = 'http://127.0.0.1:3174'
const api = 'http://127.0.0.1:55993'
const password = 'OT9-local-synthetic-only!'
const fixtureDatabase = process.env.OT_MISSION9_TEST_DATABASE || 'ot_cutover02_m9_full_e2e'

async function login(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${app}/login`)
  await page.getByLabel('Tài khoản nhân sự').fill(`ot9_${role}`)
  await page.getByLabel('Mật khẩu xác thực').fill(password)
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Đăng nhập Cổng Doanh nghiệp' }).click()
  assert.equal((await response).status(), 200, `login ${role}`)
  return { context, page }
}

async function clickAndAcceptConfirm(page, locator) {
  const dialogPromise = new Promise((resolve, reject) => {
    page.once('dialog', async dialog => {
      try {
        assert.equal(dialog.type(), 'confirm')
        await dialog.accept()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  })
  await locator.click()
  await dialogPromise
}

async function approveRequest(page, drawer, requestId, amendment = false) {
  const decisionPath = amendment ? 'amend-approve' : 'approve'
  const response = page.waitForResponse(
    r => r.url().endsWith(`/api/v1/overtime-requests/${requestId}/${decisionPath}`)
      && r.request().method() === 'POST')
  await clickAndAcceptConfirm(page, drawer.locator('.overtime-drawer-actions button.btn-primary'))
  const result = await response
  assert.equal(result.status(), 200, await result.text())
}

async function allocateSchedules() {
  const response = await fetch(`${api}/fixture/work-schedules`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Synthetic schedule allocation failed: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json()
}

async function advanceFixtureClock(day) {
  const response = await fetch(`${api}/fixture/test-clock`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: `${day}T20:01:00+07:00` }),
  })
  assert.equal(response.status, 200, `synthetic test clock: ${await response.text()}`)
}

async function submitSelfRequest(page, day, reason) {
  await page.goto(`${app}/my-overtime`)
  await page.getByRole('button', { name: 'Đăng ký tăng ca', exact: true }).click()
  const modal = page.getByRole('heading', { name: 'Đăng Ký Làm Thêm Giờ (OT)' })
    .locator('xpath=ancestor::div[contains(@class,"card")][1]')
  await modal.locator('input[type="date"]').fill(day)
  await modal.locator('textarea').fill(reason)
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/overtime-requests') && r.request().method() === 'POST')
  await modal.getByRole('button', { name: 'Gửi đăng ký OT' }).click()
  const created = await response
  assert.equal(created.status(), 201, await created.text())
  return (await created.json()).request_id
}

async function main() {
  const health = await (await fetch(`${api}/fixture/health`)).json()
  assert.deepEqual(health, { database: fixtureDatabase, policy: 'DISABLED' })
  const runId = randomUUID()
  const { employee_work_date: day, manager_work_date: managerDay } = await allocateSchedules()
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  })
  try {
    const employee = await login(browser, 'employee')
    let hr
    if (!process.argv.includes('--manager-only')) {
    await employee.page.goto(`${app}/my-overtime`)
    await employee.page.getByRole('button', { name: 'Đăng ký tăng ca', exact: true }).click()
    const modal = employee.page.getByRole('heading', { name: 'Đăng Ký Làm Thêm Giờ (OT)' })
      .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    await modal.locator('input[type="date"]').fill(day)
    await modal.locator('textarea').fill(`Synthetic browser end-to-end inventory ${runId}`)
    const createdResponse = employee.page.waitForResponse(r => r.url().endsWith('/api/v1/overtime-requests') && r.request().method() === 'POST')
    await modal.getByRole('button', { name: 'Gửi đăng ký OT' }).click()
    const created = await createdResponse
    assert.equal(created.status(), 201, await created.text())
    const requestId = (await created.json()).request_id
    await employee.page.getByText('Đã nộp đơn đăng ký tăng ca thành công!').waitFor()
    await modal.waitFor({ state: 'detached' })
    const state = await (await fetch(`${api}/fixture/state/${requestId}`)).json()
    assert.equal(state.status, 'PENDING_HR')
    console.log(`PASS WEB-SELF-01: browser login/create/submit request=${requestId}`)

    hr = await login(browser, 'hr')
    await hr.page.goto(`${app}/overtime?request_id=${requestId}`)
    const drawer = hr.page.getByRole('dialog', { name: `OT #${requestId}` })
    await drawer.waitFor()
    await approveRequest(hr.page, drawer, requestId)
    console.log('PASS WEB-HR-01: HR browser login, deep link Drawer and approve via real API')

    const attendance = await fetch(`${api}/fixture/attendance`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    })
    assert.equal(attendance.status, 200, await attendance.text())
    await advanceFixtureClock(day)
    const section = drawer.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    const previewResponse = hr.page.waitForResponse(r => r.url().endsWith(`/api/v1/overtime-reconciliations/${requestId}/preview`) && r.request().method() === 'POST')
    await section.getByRole('button', { name: 'Xem trước đối soát' }).click()
    assert.equal((await previewResponse).status(), 200)
    const verifyResponse = hr.page.waitForResponse(r => r.url().endsWith(`/api/v1/overtime-reconciliations/${requestId}/verify`) && r.request().method() === 'POST')
    await section.getByRole('button', { name: 'Xác minh OT' }).click()
    assert.equal((await verifyResponse).status(), 200)
    await section.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    const finalState = await (await fetch(`${api}/fixture/state/${requestId}`)).json()
    assert.equal(finalState.reconciliation.status, 'VERIFIED')
    assert.equal(finalState.reconciliation.verified_microseconds, 7_200_000_000)
    console.log('PASS WEB-REC-01: Attendance synthetic -> browser preview/verify -> DB VERIFIED 2h')
    }
    hr ||= await login(browser, 'hr')

    const manager = await login(browser, 'manager')
    const resumeArg = process.argv.find(value => value.startsWith('--manager-resume='))
    let managerId = resumeArg ? Number(resumeArg.split('=')[1]) : 0
    if (!managerId) {
    await manager.page.goto(`${app}/overtime`)
    await manager.page.getByRole('button', { name: 'Tạo đơn cho nhân viên' }).click()
    const managerModal = manager.page.getByRole('heading', { name: 'Tạo Đăng Ký OT Cho Nhân Viên' })
      .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    await managerModal.locator('.employee-search-select-container').click()
    await managerModal.getByPlaceholder('Gõ tên, mã nhân viên, phòng ban...').fill('E-21')
    await managerModal.getByText('Synthetic Employee', { exact: true }).click()
    await managerModal.locator('input[type="date"]').fill(managerDay)
    await managerModal.locator('textarea').fill(`Synthetic manager browser E2E proposal ${runId}`)
    const managerCreateResponse = manager.page.waitForResponse(r => r.url().endsWith('/api/v1/overtime-requests') && r.request().method() === 'POST')
    const managerSubmitResponse = manager.page.waitForResponse(r => /\/api\/v1\/overtime-requests\/\d+\/submit$/.test(r.url()) && r.request().method() === 'POST')
    await managerModal.getByRole('button', { name: 'Tạo & Gửi phê duyệt' }).click()
    const managerCreated = await managerCreateResponse
    assert.equal(managerCreated.status(), 201, await managerCreated.text())
    managerId = (await managerCreated.json()).request_id
    assert.equal((await managerSubmitResponse).status(), 200)
    assert.equal((await (await fetch(`${api}/fixture/state/${managerId}`)).json()).status,
      'PENDING_EMPLOYEE_CONFIRMATION')
    console.log(`PASS WEB-MANAGER-01: real browser proposal request=${managerId}`)
    }

    const employeeToken = await employee.page.evaluate(() => localStorage.getItem('hrm_token'))
    const employeeNotices = await fetch(`${api}/api/v1/operations/notifications`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    }).then(response => response.json())
    const managerNotice = employeeNotices.find(item => item.href.includes(`request_id=${managerId}`))
    assert(managerNotice, 'employee notification must link to the real manager proposal')
    assert.equal(managerNotice.is_read, false)
    await employee.page.goto(`${app}/my-leave`)
    await employee.page.getByRole('button', { name: /^Thông báo:/ }).click()
    const markNoticeRead = employee.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/operations/notifications/${encodeURIComponent(managerNotice.id)}/read`)
        && r.request().method() === 'POST')
    await employee.page.locator('.notification-item').filter({ hasText: managerNotice.title }).click()
    assert.equal((await markNoticeRead).status(), 200)
    await employee.page.waitForURL('**/my-overtime?request_id=*')
    assert.equal(new URL(employee.page.url()).searchParams.get('request_id'), String(managerId))
    console.log(`PASS WEB-NOTIFY-01: unread notice marked read and opened OT deep link request=${managerId}`)
    const employeeDrawer = employee.page.getByRole('dialog', { name: `OT #${managerId}` })
    await employeeDrawer.waitFor()
    const confirmedResponse = employee.page.waitForResponse(r => r.url().endsWith(`/api/v1/overtime-requests/${managerId}/employee-confirm`) && r.request().method() === 'POST')
    await clickAndAcceptConfirm(
      employee.page, employeeDrawer.locator('.overtime-drawer-actions button.btn-primary'))
    assert.equal((await confirmedResponse).status(), 200)
    await hr.page.goto(`${app}/overtime?request_id=${managerId}`)
    const managerDrawer = hr.page.getByRole('dialog', { name: `OT #${managerId}` })
    await managerDrawer.waitFor()
    await approveRequest(hr.page, managerDrawer, managerId)
    const managerAttendance = await fetch(`${api}/fixture/attendance`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: managerId }),
    })
    assert.equal(managerAttendance.status, 200, await managerAttendance.text())
    await advanceFixtureClock(managerDay)
    const managerSection = managerDrawer.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    await managerSection.getByRole('button', { name: 'Xem trước đối soát' }).click()
    await managerSection.getByRole('button', { name: 'Xác minh OT' }).click()
    await managerSection.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    const managerState = await (await fetch(`${api}/fixture/state/${managerId}`)).json()
    assert.equal(managerState.reconciliation.verified_microseconds, 7_200_000_000)
    console.log('PASS WEB-MANAGER-02: employee confirms, HR approves, Attendance and VERIFIED via real OT APIs')

    const { employee_work_date: rejectDay } = await allocateSchedules()
    const rejectedId = await submitSelfRequest(
      employee.page, rejectDay, `Synthetic HR reject ${runId}`)
    await hr.page.goto(`${app}/overtime?request_id=${rejectedId}`)
    const rejectDrawer = hr.page.getByRole('dialog', { name: `OT #${rejectedId}` })
    await rejectDrawer.waitFor()
    await rejectDrawer.getByRole('button', { name: 'Từ chối đơn', exact: true }).click()
    await hr.page.getByPlaceholder('Nhập lý do...').fill('Synthetic rejection review')
    const rejectResponse = hr.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${rejectedId}/reject`) && r.request().method() === 'POST')
    const rejectConfirm = hr.page.locator('button.btn-danger:visible').last()
    assert.equal(await rejectConfirm.isEnabled(), true, 'reject confirmation should enable after reason entry')
    await rejectConfirm.click()
    assert.equal((await rejectResponse).status(), 200)
    const rejectedState = await (await fetch(`${api}/fixture/state/${rejectedId}`)).json()
    assert.equal(rejectedState.status, 'REJECTED')
    assert(rejectedState.events.some(event => event.action === 'REJECT'))
    console.log(`PASS WEB-REJECT-01: HR rejected a browser-submitted request=${rejectedId}`)

    const { manager_work_date: declineDay } = await allocateSchedules()
    await manager.page.goto(`${app}/overtime`)
    await manager.page.getByRole('button', { name: 'Tạo đơn cho nhân viên' }).click()
    const declineModal = manager.page.getByRole('heading', { name: 'Tạo Đăng Ký OT Cho Nhân Viên' })
      .locator('xpath=ancestor::div[contains(@class,"card")][1]')
    await declineModal.locator('.employee-search-select-container').click()
    await declineModal.getByPlaceholder('Gõ tên, mã nhân viên, phòng ban...').fill('E-21')
    await declineModal.getByText('Synthetic Employee', { exact: true }).click()
    await declineModal.locator('input[type="date"]').fill(declineDay)
    await declineModal.locator('textarea').fill(`Synthetic employee decline ${runId}`)
    const declineCreate = manager.page.waitForResponse(
      r => r.url().endsWith('/api/v1/overtime-requests') && r.request().method() === 'POST')
    const declineSubmit = manager.page.waitForResponse(
      r => /\/api\/v1\/overtime-requests\/\d+\/submit$/.test(r.url()) && r.request().method() === 'POST')
    await declineModal.getByRole('button', { name: 'Tạo & Gửi phê duyệt' }).click()
    const declineCreated = await declineCreate
    assert.equal(declineCreated.status(), 201, await declineCreated.text())
    const declinedId = (await declineCreated.json()).request_id
    assert.equal((await declineSubmit).status(), 200)
    await employee.page.goto(`${app}/my-overtime?request_id=${declinedId}`)
    const declineDrawer = employee.page.getByRole('dialog', { name: `OT #${declinedId}` })
    await declineDrawer.waitFor()
    await declineDrawer.getByRole('button', { name: 'Từ chối đề xuất' }).click()
    await employee.page.getByPlaceholder('Nhập lý do...').fill('Synthetic schedule conflict')
    const declineResponse = employee.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${declinedId}/employee-decline`)
        && r.request().method() === 'POST')
    await employee.page.locator('button.btn-danger:visible').last().click()
    assert.equal((await declineResponse).status(), 200)
    const declinedState = await (await fetch(`${api}/fixture/state/${declinedId}`)).json()
    assert.equal(declinedState.status, 'EMPLOYEE_DECLINED')
    assert(declinedState.events.some(event => event.action === 'EMPLOYEE_DECLINE'))
    console.log(`PASS WEB-DECLINE-01: employee declined manager proposal request=${declinedId}`)

    const { employee_work_date: revokeDay } = await allocateSchedules()
    const revokeId = await submitSelfRequest(
      employee.page, revokeDay, `Synthetic revocation ${runId}`)
    await hr.page.goto(`${app}/overtime?request_id=${revokeId}`)
    const approveForRevoke = hr.page.getByRole('dialog', { name: `OT #${revokeId}` })
    await approveForRevoke.waitFor()
    await approveRequest(hr.page, approveForRevoke, revokeId)
    await employee.page.goto(`${app}/my-overtime?request_id=${revokeId}`)
    const employeeRevokeDrawer = employee.page.getByRole('dialog', { name: `OT #${revokeId}` })
    await employeeRevokeDrawer.waitFor()
    await employeeRevokeDrawer.locator('.overtime-drawer-actions button.btn-secondary').nth(1).click()
    await employee.page.locator('textarea:visible').last().fill('Synthetic schedule changed')
    const revokeSubmitButton = employee.page.locator('button.btn-danger:visible').last()
    await revokeSubmitButton.waitFor()
    assert.equal(await revokeSubmitButton.isEnabled(), true)
    const revokeRequest = employee.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${revokeId}/revoke-request`)
        && r.request().method() === 'POST')
    await revokeSubmitButton.click()
    assert.equal((await revokeRequest).status(), 200)
    await hr.page.goto(`${app}/overtime?request_id=${revokeId}`)
    const hrRevokeDrawer = hr.page.getByRole('dialog', { name: `OT #${revokeId}` })
    await hrRevokeDrawer.waitFor()
    const revokeDecision = hr.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${revokeId}/revoke-approve`)
        && r.request().method() === 'POST')
    await clickAndAcceptConfirm(hr.page, hrRevokeDrawer.locator('.overtime-drawer-actions button.btn-danger'))
    assert.equal((await revokeDecision).status(), 200)
    const revokedState = await (await fetch(`${api}/fixture/state/${revokeId}`)).json()
    assert.equal(revokedState.status, 'REVOKED')
    assert(revokedState.events.some(event => event.action === 'REVOKE_APPROVE'))
    console.log(`PASS WEB-REVOKE-01: employee request and HR-approved revocation request=${revokeId}`)

    const { employee_work_date: revokeRejectDay } = await allocateSchedules()
    const revokeRejectId = await submitSelfRequest(
      employee.page, revokeRejectDay, `Synthetic rejected revocation ${runId}`)
    await hr.page.goto(`${app}/overtime?request_id=${revokeRejectId}`)
    const approveForRejectedRevoke = hr.page.getByRole(
      'dialog', { name: `OT #${revokeRejectId}` })
    await approveForRejectedRevoke.waitFor()
    await approveRequest(hr.page, approveForRejectedRevoke, revokeRejectId)
    await employee.page.goto(`${app}/my-overtime?request_id=${revokeRejectId}`)
    const employeeRejectRevoke = employee.page.getByRole(
      'dialog', { name: `OT #${revokeRejectId}` })
    await employeeRejectRevoke.waitFor()
    await employeeRejectRevoke.locator('.overtime-drawer-actions button.btn-secondary').nth(1).click()
    await employee.page.locator('textarea:visible').last().fill('Synthetic cancellation no longer needed')
    const requestRejection = employee.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${revokeRejectId}/revoke-request`)
        && r.request().method() === 'POST')
    await employee.page.locator('button.btn-danger:visible').last().click()
    assert.equal((await requestRejection).status(), 200)
    await hr.page.goto(`${app}/overtime?request_id=${revokeRejectId}`)
    const hrRejectRevoke = hr.page.getByRole('dialog', { name: `OT #${revokeRejectId}` })
    await hrRejectRevoke.waitFor()
    await hrRejectRevoke.locator('.overtime-drawer-actions button.btn-secondary').last().click()
    await hr.page.getByPlaceholder('Nhập lý do...').fill('Synthetic schedule remains required')
    const revokeRejectedResponse = hr.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${revokeRejectId}/revoke-reject`)
        && r.request().method() === 'POST')
    await hr.page.locator('button.btn-danger:visible').last().click()
    assert.equal((await revokeRejectedResponse).status(), 200)
    const revokeRejectedState = await (await fetch(`${api}/fixture/state/${revokeRejectId}`)).json()
    assert.equal(revokeRejectedState.status, 'APPROVED')
    assert(revokeRejectedState.events.some(event => event.action === 'REVOKE_REJECT'))
    console.log(`PASS WEB-REVOKE-02: HR rejection preserves approved OT request=${revokeRejectId}`)

    const { employee_work_date: amendmentBaseDay, manager_work_date: amendmentDay } =
      await allocateSchedules()
    const amendmentParentId = await submitSelfRequest(
      employee.page, amendmentBaseDay, `Synthetic amendment original ${runId}`)
    await hr.page.goto(`${app}/overtime?request_id=${amendmentParentId}`)
    const amendmentApproval = hr.page.getByRole(
      'dialog', { name: `OT #${amendmentParentId}` })
    await amendmentApproval.waitFor()
    await approveRequest(hr.page, amendmentApproval, amendmentParentId)
    await employee.page.goto(`${app}/my-overtime?request_id=${amendmentParentId}`)
    const amendmentDrawer = employee.page.getByRole(
      'dialog', { name: `OT #${amendmentParentId}` })
    await amendmentDrawer.waitFor()
    await amendmentDrawer.locator('.overtime-drawer-actions button.btn-secondary').first().click()
    await employee.page.locator('input[type="date"]:visible').last().fill(amendmentDay)
    await employee.page.locator('input[type="time"]:visible').first().fill('18:00')
    await employee.page.locator('input[type="time"]:visible').last().fill('20:00')
    await employee.page.locator('textarea:visible').last().fill('Synthetic date correction')
    const amendmentCreatedResponse = employee.page.waitForResponse(
      r => r.url().endsWith(`/api/v1/overtime-requests/${amendmentParentId}/amend`)
        && r.request().method() === 'POST')
    await employee.page.locator('button.btn-primary:visible').last().click()
    const amendmentCreated = await amendmentCreatedResponse
    assert.equal(amendmentCreated.status(), 201, await amendmentCreated.text())
    const amendmentId = (await amendmentCreated.json()).request_id
    await hr.page.goto(`${app}/overtime?request_id=${amendmentId}`)
    const amendmentReview = hr.page.getByRole('dialog', { name: `OT #${amendmentId}` })
    await amendmentReview.waitFor()
    await approveRequest(hr.page, amendmentReview, amendmentId, true)
    const parentState = await (await fetch(`${api}/fixture/state/${amendmentParentId}`)).json()
    const amendmentState = await (await fetch(`${api}/fixture/state/${amendmentId}`)).json()
    assert.equal(parentState.status, 'REPLACED')
    assert.equal(amendmentState.status, 'APPROVED')
    console.log(`PASS WEB-AMEND-01: employee amendment replaces parent atomically ${amendmentParentId}->${amendmentId}`)

    await employee.context.close()
    await hr.context.close()
    await manager.context.close()
  } finally {
    await browser.close()
    await fetch(`${api}/fixture/test-clock`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: null }),
    }).catch(() => undefined)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

