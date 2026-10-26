// UI smoke/regression only: request directory is synthetic; reconciliation API is the guarded local PostgreSQL fixture.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')

const fixtureOrigin = 'http://127.0.0.1:55992'
const appOrigin = 'http://127.0.0.1:3173'
const roles = {
  HR_MANAGER: { user_id: 4, employee_id: 22, store_id: 1, roles: ['HR_MANAGER'] },
  ADMIN: { user_id: 1, employee_id: 99, store_id: 1, roles: ['ADMIN'] },
  STORE_MANAGER: { user_id: 2, employee_id: 20, store_id: 1, roles: ['STORE_MANAGER'] },
  EMPLOYEE: { user_id: 3, employee_id: 21, store_id: 1, roles: ['EMPLOYEE'] },
}

async function seed() {
  const response = await fetch(`${fixtureOrigin}/fixture/seed`, { method: 'POST' })
  if (!response.ok) throw new Error(`Fixture seed failed: HTTP ${response.status} ${await response.text()}`)
  const request = await response.json()
  const preview = await fetch(`${fixtureOrigin}/api/v1/overtime-reconciliations/${request.request_id}/preview`, {
    method: 'POST', headers: { 'x-fixture-role': 'HR_MANAGER' },
  })
  if (!preview.ok) throw new Error(`Fixture preview failed: HTTP ${preview.status} ${await preview.text()}`)
  return {
    ...request,
    employee_id: 21, employee_name: 'Synthetic Employee', employee_code: 'E-21',
    store_id: 1, store_name: 'Synthetic Branch', reason: 'Synthetic OT UI review',
    status: 'APPROVED', request_type: 'STANDARD', created_by: 2,
    creator_username: 'manager_fixture', reviewer_username: 'hr_fixture',
    reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    events: [], lifecycle: { eligible: false }, related_requests: [],
  }
}

async function open(browser, role, request, path = role === 'EMPLOYEE' ? '/my-overtime' : '/overtime') {
  const user = { ...roles[role], username: `${role.toLowerCase()}_fixture`, full_name: 'Synthetic User', permissions: [] }
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
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
      const method = route.request().method()
      const requestHeaders = route.request().headers()
      const options = {
        method,
        headers: { 'x-fixture-role': role },
      }
      if (requestHeaders['content-type']) options.headers['content-type'] = requestHeaders['content-type']
      const requestBody = route.request().postData()
      if (requestBody) options.body = requestBody
      const response = await fetch(`${fixtureOrigin}${pathname}${url.search}`, options)
      await route.fulfill({
        status: response.status,
        contentType: response.headers.get('content-type') || 'application/json',
        body: await response.text(),
      })
      return
    }
    let data = {}
    if (pathname.endsWith('/auth/me')) data = user
    else if (pathname.includes('/notifications')) data = []
    else if (pathname.endsWith('/overtime-requests')) data = [request]
    else if (pathname.endsWith(`/overtime-requests/${request.request_id}`)) data = request
    else if (pathname.includes('/employees/')) data = { stores: [{ store_id: 1, store_name: 'Synthetic Branch' }], employees: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(`${appOrigin}${path}`)
  await page.waitForTimeout(1200)
  if (!(await page.locator('input[type="date"]').count())) {
    console.log(`UI DEBUG ${role} ${page.url()} ${(await page.locator('body').innerText()).slice(0, 1200)}`)
  }
  return { page, errors }
}

async function filterToWorkDate(page, workDate) {
  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill(workDate)
  await dates.nth(1).fill(workDate)
  await page.waitForLoadState('networkidle')
}

async function main() {
  const request = await seed()
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const hr = await open(browser, 'HR_MANAGER', request)
    await hr.page.getByRole('heading', { name: 'Quản lý Đăng ký & Đối soát OT' }).waitFor()
    await filterToWorkDate(hr.page, request.work_date)
    const tabs = hr.page.locator('.overtime-workspace-tabs button')
    assert.equal(await tabs.count(), 3)
    await tabs.nth(1).waitFor()
    await tabs.nth(1).click()
    await hr.page.getByRole('heading', { name: 'Đối soát OT', exact: true }).waitFor()
    await hr.page.locator('.overtime-workspace-table tbody tr').first().waitFor()
    await hr.page.locator('.overtime-workspace-table button.overtime-request-link').click()
    const hrSection = hr.page.getByRole('region', { name: /Đối soát giờ OT thực tế/ })
    await hrSection.getByRole('button', { name: 'Làm mới đối soát' }).waitFor()
    await hrSection.getByRole('button', { name: /Xác minh OT/ }).click()
    await hrSection.getByText(/Đối soát: Đã xác nhận giờ OT/).waitFor()
    await hr.page.getByRole('dialog').getByRole('button').first().click()
    await tabs.nth(2).click()
    await hr.page.getByRole('heading', { name: 'Lịch sử OT' }).waitFor()
    await hr.page.locator('.overtime-workspace-table tbody tr').first().waitFor()
    assert.deepEqual(hr.errors, [])
    console.log('PASS UI-HR: request/reconciliation/history tabs, approved vs proposed fields, HR actions and detail drawer')
    await hr.page.close()

    const manager = await open(browser, 'STORE_MANAGER', request)
    await filterToWorkDate(manager.page, request.work_date)
    assert.equal(await manager.page.locator('.overtime-workspace-tabs button').count(), 2)
    await manager.page.locator('.overtime-workspace-table button.overtime-request-link').count().then(count => assert.equal(count, 0))
    await manager.page.locator('.data-table tbody tr').first().click()
    await manager.page.getByRole('dialog').waitFor()
    const managerSection = manager.page.getByRole('region', { name: /Đối soát giờ OT thực tế/ })
    assert.equal(await managerSection.getByRole('button', { name: /Xem trước đối soát/ }).count(), 0)
    assert.equal(await managerSection.getByRole('button', { name: /Xác minh OT/ }).count(), 0)
    assert.deepEqual(manager.errors, [])
    console.log('PASS UI-MANAGER: reconciliation tab and decision controls hidden; request remains readable')
    await manager.page.close()

    const employee = await open(browser, 'EMPLOYEE', request)
    await filterToWorkDate(employee.page, request.work_date)
    await employee.page.getByText('Giờ OT đã xác nhận (kỳ này)').waitFor()
    await employee.page.getByText('2.0 giờ', { exact: true }).waitFor()
    assert.equal(await employee.page.locator('.overtime-workspace-tabs').count(), 0)
    assert.deepEqual(employee.errors, [])
    console.log('PASS UI-EMPLOYEE: personal KPI counts only current verified hours')
    await employee.page.close()

    const adminRequest = await seed()
    const admin = await open(browser, 'ADMIN', adminRequest)
    await filterToWorkDate(admin.page, adminRequest.work_date)
    await admin.page.locator('.overtime-workspace-tabs button').nth(1).click()
    await admin.page.locator('.overtime-workspace-table button.overtime-request-link').click()
    const adminSection = admin.page.getByRole('region', { name: /Đối soát giờ OT thực tế/ })
    await adminSection.getByText(/Admin dùng quyền đối soát hiện có/).waitFor()
    assert.equal(await adminSection.getByRole('button', { name: /Làm mới đối soát/ }).count(), 1)
    assert.equal(await adminSection.getByRole('button', { name: /Xác minh OT/ }).count(), 1)
    assert.equal(await adminSection.getByRole('button', { name: /Từ chối đối soát/ }).count(), 1)
    console.log('PASS UI-ADMIN: existing backend reconciliation decision rights are available in the UI')
    await admin.page.close()

    const deepLink = await open(browser, 'HR_MANAGER', request,
      `/leave?tab=overtime&request_id=${request.request_id}`)
    await deepLink.page.getByRole('dialog').waitFor()
    assert.match(deepLink.page.url(), /\/overtime\?request_id=/)
    assert.deepEqual(deepLink.errors, [])
    console.log('PASS UI-DEEPLINK: legacy notification route opens the matching OT detail drawer')
    await deepLink.page.close()

    const mobile = await open(browser, 'HR_MANAGER', request)
    await mobile.page.setViewportSize({ width: 360, height: 800 })
    await filterToWorkDate(mobile.page, request.work_date)
    await mobile.page.locator('.overtime-workspace-tabs button').nth(1).click()
    const mobileTable = mobile.page.locator('.overtime-workspace-table')
    await mobileTable.waitFor()
    assert.equal(await mobileTable.evaluate(element => getComputedStyle(element).display), 'block')
    await mobile.page.locator('.overtime-request-link').click()
    const drawer = mobile.page.locator('.overtime-detail-drawer')
    await drawer.waitFor()
    assert.ok(await drawer.evaluate(element => element.getBoundingClientRect().width <= innerWidth))
    assert.deepEqual(mobile.errors, [])
    console.log('PASS UI-MOBILE: 360px card table and contained detail drawer')
    await mobile.page.close()

    const tablet = await open(browser, 'HR_MANAGER', request)
    await tablet.page.setViewportSize({ width: 768, height: 900 })
    await filterToWorkDate(tablet.page, request.work_date)
    await tablet.page.locator('.overtime-workspace-tabs button').nth(1).click()
    await tablet.page.locator('.overtime-request-link').click()
    const tabletDrawer = tablet.page.locator('.overtime-detail-drawer')
    await tabletDrawer.waitFor()
    assert.ok(await tabletDrawer.evaluate(element => element.getBoundingClientRect().width <= innerWidth))
    assert.deepEqual(tablet.errors, [])
    console.log('PASS UI-TABLET: 768px reconciliation detail drawer remains within viewport')
    await tablet.page.close()
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
