// Browser UI acceptance with real OT reconciliation API on isolated local PostgreSQL.
// Other application endpoints use synthetic responses; no Supabase traffic is allowed.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')

const fixtureOrigin = 'http://127.0.0.1:55992'
const appOrigin = 'http://127.0.0.1:3173'
const users = {
  HR_MANAGER: { user_id: 4, employee_id: 22, store_id: 1, roles: ['HR_MANAGER'] },
  ADMIN: { user_id: 1, employee_id: 99, store_id: 1, roles: ['ADMIN'] },
  STORE_MANAGER: { user_id: 2, employee_id: 20, store_id: 1, roles: ['STORE_MANAGER'] },
  EMPLOYEE: { user_id: 3, employee_id: 21, store_id: 1, roles: ['EMPLOYEE'] },
}

async function fixtureRequest(missingAttendance = false) {
  const response = await fetch(`${fixtureOrigin}/fixture/seed?missing_attendance=${missingAttendance}`, { method: 'POST' })
  if (response.status !== 200) throw new Error(`Synthetic seed HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

async function open(browser, role, fixture, width = 1280) {
  const user = { ...users[role], username: `${role.toLowerCase()}_fixture`,
    full_name: 'Synthetic OT User', permissions: [] }
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(value => {
    localStorage.setItem('hrm_token', 'local-fixture-only')
    localStorage.setItem('hrm_user', JSON.stringify(value))
  }, user)
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (pathname.includes('/overtime-reconciliations')) {
      const response = await route.fetch({
        url: `${fixtureOrigin}${pathname}${url.search}`,
        headers: { ...route.request().headers(), 'x-fixture-role': role },
      })
      await route.fulfill({ response })
      return
    }
    const request = {
      ...fixture, employee_id: 21, employee_name: 'Synthetic Employee',
      employee_code: 'E-21', store_id: 1, store_name: 'Synthetic Branch One',
      reason: 'Synthetic browser OT-CUTOVER-03', status: 'APPROVED',
      request_type: 'STANDARD', created_by: 2, creator_username: 'manager_test',
      reviewed_by: 4, reviewer_username: 'hr_test',
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      events: [], approval_context: { related_schedules: [], conflicts: [] },
      lifecycle: { eligible: false, attendance_linked: true, revocation_pending: false },
    }
    let data = []
    if (pathname.endsWith('/auth/me')) data = user
    if (pathname.endsWith('/overtime-requests')) data = [request]
    if (pathname.endsWith(`/overtime-requests/${fixture.request_id}`)) data = request
    if (pathname.endsWith('/employees/lookups')) data = { stores: [], employees: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const requestPath = role === 'EMPLOYEE' ? '/my-overtime' : '/overtime'
  await page.goto(`${appOrigin}${requestPath}?request_id=${fixture.request_id}`)
  await page.getByRole('dialog', { name: `OT #${fixture.request_id}` }).waitFor()
  if (role === 'EMPLOYEE') assert(new URL(page.url()).pathname === '/my-overtime')
  else assert(new URL(page.url()).pathname === '/overtime')
  await page.getByRole('region', { name: 'Đối soát giờ OT thực tế' }).waitFor()
  await page.getByText('Attendance thực tế giao khung OT').waitFor()
  assert.deepEqual(errors, [])
  return page
}

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  })
  try {
    const fixture = await fixtureRequest()
    const hr = await open(browser, 'HR_MANAGER', fixture)
    const section = hr.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    assert((await section.innerText()).includes('2 giờ 00 phút'))
    await section.getByText('Đối soát: Chờ đối soát').waitFor()
    await section.getByRole('button', { name: 'Xem trước đối soát' }).click()
    await section.getByText('Phiên bản #1', { exact: true }).waitFor()
    await section.getByRole('button', { name: 'Xác minh OT' }).click()
    await section.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    assert((await section.innerText()).includes('Phiên #'))
    assert((await section.innerText()).includes('Lịch sử đối soát'))
    await hr.getByRole('button', { name: 'Đóng chi tiết' }).click()
    await hr.locator('.leave-tab-btn').first().click()
    assert((await hr.locator('.overtime-request-table tbody').innerText()).includes('Không tìm thấy'))
    await hr.locator('.overtime-query-control input').fill('giữ bộ lọc')
    await hr.locator('.overtime-workspace-tabs button').first().click()
    await hr.locator('.overtime-request-table tbody').waitFor()
    await hr.locator('.leave-tab-btn').first().click()
    assert.equal(await hr.locator('.overtime-query-control input').inputValue(), 'giữ bộ lọc')
    await hr.close()

    const employee = await open(browser, 'EMPLOYEE', fixture, 360)
    const employeeSection = employee.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    await employeeSection.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    assert.equal(await employeeSection.getByRole('button', { name: 'Xác minh OT' }).count(), 0)
    assert.equal(await employeeSection.getByRole('button', { name: 'Làm mới đối soát' }).count(), 0)
    assert(await employee.locator('.overtime-detail-drawer').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await employee.close()

    const tabletEmployee = await open(browser, 'EMPLOYEE', fixture, 768)
    assert(await tabletEmployee.locator('.overtime-detail-drawer')
      .evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await tabletEmployee.close()

    const manager = await open(browser, 'STORE_MANAGER', fixture)
    const managerSection = manager.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    assert.equal(await managerSection.getByRole('button', { name: 'Xác minh OT' }).count(), 0)
    assert.equal(await managerSection.getByRole('button', { name: 'Xem trước đối soát' }).count(), 0)
    assert.equal(await managerSection.getByRole('button', { name: 'Làm mới đối soát' }).count(), 0)
    await manager.close()

    const changed = await fetch(`${fixtureOrigin}/fixture/shorten/${fixture.request_id}`, { method: 'POST' })
    assert.equal(changed.status, 200)
    const staleHr = await open(browser, 'HR_MANAGER', fixture)
    const staleSection = staleHr.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    await staleSection.getByText('Nguồn dữ liệu đã thay đổi').waitFor()
    await staleSection.getByText('Đối soát: Cần rà soát').waitFor()
    assert.equal(await staleSection.getByRole('button', { name: 'Xác minh OT' }).count(), 0)
    await staleHr.close()

    const missing = await fixtureRequest(true)
    const reviewHr = await open(browser, 'HR_MANAGER', missing)
    const reviewSection = reviewHr.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    await reviewSection.getByRole('button', { name: 'Xem trước đối soát' }).click()
    await reviewSection.getByText('Đối soát: Cần rà soát').waitFor()
    await reviewSection.getByText('Chưa có phiên Attendance giao với khung OT.').waitFor()
    assert(await reviewSection.getByRole('button', { name: 'Xác minh OT' }).isDisabled())
    await reviewSection.getByRole('button', { name: 'Từ chối đối soát' }).click()
    await reviewSection.getByRole('textbox', { name: 'Lý do từ chối đối soát' }).fill('Không có phiên chấm công hợp lệ')
    await reviewSection.getByRole('button', { name: 'Xác nhận từ chối' }).click()
    await reviewSection.getByText('Đối soát: Đã từ chối đối soát').waitFor()
    await reviewHr.close()

    const second = await fixtureRequest()
    const admin = await open(browser, 'ADMIN', second)
    const adminSection = admin.getByRole('region', { name: 'Đối soát giờ OT thực tế' })
    await adminSection.getByRole('button', { name: 'Xem trước đối soát' }).click()
    await adminSection.getByText('Phiên bản #1', { exact: true }).waitFor()
    const otherDecision = await fetch(`${fixtureOrigin}/api/v1/overtime-reconciliations/${second.request_id}/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-role': 'SECOND_HR' },
      body: JSON.stringify({ expected_version: 1 }),
    })
    assert.equal(otherDecision.status, 200, await otherDecision.text())
    await adminSection.getByRole('button', { name: 'Xác minh OT' }).click()
    await adminSection.getByText(/Dữ liệu mới nhất đã được tải lại/).waitFor()
    await adminSection.getByText('Đối soát: Đã xác nhận giờ OT').waitFor()
    await admin.close()
    console.log('PASS: HR preview/verify/reject, missing Attendance, stale source, employee/manager RBAC, mobile layout, Admin 409 refresh; real local OT API and synthetic PostgreSQL.')
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

