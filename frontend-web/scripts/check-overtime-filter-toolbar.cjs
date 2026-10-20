// Browser UI smoke. All HRM APIs are intercepted and mocked; this script never reaches a backend/database.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const origin = 'http://127.0.0.1:3173'
const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const start = `${workDate}T11:00:00+07:00`
const end = `${workDate}T13:00:00+07:00`
const user = { user_id: 4, employee_id: 22, store_id: 1, username: 'hr_ui_fixture', full_name: 'HR UI Fixture', roles: ['HR_MANAGER'], permissions: [] }
const requestFixture = {
  request_id: 95001, employee_id: 31, store_id: 2, work_date: workDate,
  starts_at: start, ends_at: end, reason: 'Synthetic filter toolbar smoke', notes: '',
  status: 'APPROVED', request_type: 'STANDARD', created_by: 2,
  employee_name: 'Synthetic Employee', employee_code: 'E-31', store_name: 'Synthetic Branch 2',
  creator_username: 'manager_fixture', reviewer_username: 'hr_fixture',
  reviewed_at: start, updated_at: start, created_at: start,
  employee_confirmed_at: start, employee_responded_at: start,
  revoke_requested_at: null, revoke_decided_at: null, revoked_at: null,
  is_overdue: false, events: [], lifecycle: { eligible: false }, related_requests: [],
}
const reconciliationFixture = {
  request_id: requestFixture.request_id, status: 'PENDING_RECONCILIATION',
  effective_status: 'PENDING_RECONCILIATION', version: 0, source_current: true,
  actual_microseconds: 0, proposed_microseconds: 0, verified_microseconds: 0,
  payable_microseconds: 0, attendance_ids: [], attendance_sources: [],
  eligible_intervals: [], events: [], review_issues: [],
}
const verifiedReconciliationFixture = {
  ...reconciliationFixture,
  status: 'VERIFIED', effective_status: 'VERIFIED', version: 1,
  verified_microseconds: 7_200_000_000, payable_microseconds: 7_200_000_000,
  eligible_intervals: [{ starts_at: start, ends_at: end }],
}
const unverifiedRequestFixture = {
  ...requestFixture, request_id: 95002, starts_at: `${workDate}T14:00:00+07:00`,
  ends_at: `${workDate}T18:00:00+07:00`, reason: 'Synthetic unverified request',
}

async function openPage(browser, path = '/overtime', userValue = user, behavior = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  const overtimeQueries = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(value => {
    localStorage.setItem('hrm_token', 'ui-mock-token')
    localStorage.setItem('hrm_user', JSON.stringify(value))
  }, userValue)
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const pathName = url.pathname
    if (pathName.endsWith('/overtime-requests')) {
      overtimeQueries.push({ ...Object.fromEntries(url.searchParams.entries()) })
      if (behavior.requestListDelayMs) await new Promise(resolve => setTimeout(resolve, behavior.requestListDelayMs))
      if (behavior.requestListError) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic API unavailable' }) })
      const personalList = userValue.roles.includes('EMPLOYEE') ? [requestFixture, unverifiedRequestFixture] : [requestFixture]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(personalList) })
    }
    if (pathName.endsWith(`/overtime-requests/${requestFixture.request_id}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(requestFixture) })
    }
    if (pathName.endsWith('/overtime-reconciliations')) {
      const rec = userValue.roles.includes('EMPLOYEE') ? verifiedReconciliationFixture : reconciliationFixture
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rec]) })
    }
    if (pathName.endsWith(`/overtime-reconciliations/${requestFixture.request_id}`)) {
      const rec = userValue.roles.includes('EMPLOYEE') ? verifiedReconciliationFixture : reconciliationFixture
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rec) })
    }
    if (pathName.endsWith('/auth/me')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userValue) })
    }
    if (pathName.endsWith('/employees/metadata/lookups')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        departments: [], positions: [], stores: [
          { store_id: 1, store_code: 'TZ-01', store_name: 'Synthetic Branch 1' },
          { store_id: 2, store_code: 'TZ-02', store_name: 'Synthetic Branch 2' },
        ],
      }) })
    }
    if (pathName.endsWith('/employees')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if (pathName.includes('/notifications')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto(`${origin}${path}`)
  await page.getByRole('heading', { name: /Quản lý Đăng ký(?: & Đối soát)? OT|Đơn OT của tôi/ }).waitFor()
  await page.locator('.overtime-filter-toolbar').waitFor()
  return { page, errors, overtimeQueries }
}

async function assertNoHorizontalOverflow(page, width) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  assert.ok(metrics.pageWidth <= width + 1, `document overflow at ${width}px: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.bodyWidth <= width + 1, `body overflow at ${width}px: ${JSON.stringify(metrics)}`)
}

async function main() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const { page, errors, overtimeQueries } = await openPage(browser)
    const screenshotDir = path.join(os.tmpdir(), 'techzone-ot-compact-after')
    fs.mkdirSync(screenshotDir, { recursive: true })
    assert.equal(await page.locator('.overtime-filter-disclosure').evaluate(el => el.open), false, 'advanced filter popover starts closed')
    for (const width of [1440, 1024, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(100)
      const layout = await page.evaluate(() => {
        const rect = selector => { const element = document.querySelector(selector); if (!element) return null; const box = element.getBoundingClientRect(); return { y: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height), x: Math.round(box.left), width: Math.round(box.width) } }
        return { workspace: rect('.overtime-workspace-tabs'), toolbar: rect('.overtime-filter-toolbar'), status: rect('.overtime-status-tabs'), firstRow: rect('.overtime-request-table tbody tr'), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
      })
      await page.screenshot({ path: path.join(screenshotDir, `after-${width}.png`), fullPage: true })
      console.log(`LAYOUT ${width}px ${JSON.stringify(layout)}`)
      await assertNoHorizontalOverflow(page, width)
      if (width === 1440 || width === 1024 || width === 768 || width === 360) {
        const disclosure = page.locator('.overtime-filter-disclosure')
        await disclosure.locator('summary').click()
        const panelBox = await page.locator('#overtime-advanced-filter-panel').boundingBox()
        assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width + 1, `open popover clipped at ${width}px: ${JSON.stringify(panelBox)}`)
        if (width === 1440 || width === 360) await page.screenshot({ path: path.join(screenshotDir, `after-popover-${width}.png`), fullPage: true })
        await page.keyboard.press('Escape')
        assert.equal(await disclosure.evaluate(el => el.open), false)
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    const workspaceTabs = page.locator('.overtime-workspace-tabs button')
    assert.equal(await workspaceTabs.count(), 3, 'HR must retain all 3 business tabs')
    assert.equal(await page.locator('.overtime-status-tabs .leave-tab-btn').count(), 5, 'all 5 request status filters must remain')
    assert.equal(await page.locator('.overtime-request-table tbody tr').count(), 1)
    assert.equal(await page.locator('.overtime-pagination').count(), 0, 'mounted page currently has no pagination UI; the legacy panel is unmounted')

    const filterDetails = page.locator('.overtime-filter-disclosure')
    await filterDetails.locator('summary').click()
    const dates = filterDetails.locator('input[type="date"]')
    const queryCountBeforeDraft = overtimeQueries.length
    const previousDay = new Date(`${workDate}T00:00:00Z`)
    previousDay.setUTCDate(previousDay.getUTCDate() - 1)
    const fromDate = previousDay.toISOString().slice(0, 10)
    await dates.nth(0).fill(fromDate)
    await dates.nth(1).fill(workDate)
    await filterDetails.locator('select').selectOption('2')
    assert.equal(overtimeQueries.length, queryCountBeforeDraft, 'editing advanced filters does not query until Apply')
    await filterDetails.getByRole('button', { name: 'Áp dụng' }).click()
    assert.equal(await filterDetails.evaluate(el => el.open), false, 'Apply closes the popover')
    await page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').fill('E-31')
    await page.getByRole('button', { name: /Đã duyệt/ }).click()
    await page.locator('.overtime-request-table tbody tr').first().waitFor()
    await assertNoHorizontalOverflow(page, 1280)

    const lastQuery = overtimeQueries.at(-1)
    assert.equal(lastQuery.date_from, fromDate)
    assert.equal(lastQuery.date_to, workDate)
    assert.equal(lastQuery.store_id, '2')
    assert.equal(lastQuery.q, undefined, 'search stays client-side as before')
    assert.equal(await page.locator('.overtime-filter-chip').count(), 4, 'date, store, query and selected-status chips remain visible')
    await page.getByRole('button', { name: 'Xóa bộ lọc cửa hàng' }).click()
    assert.equal(await page.locator('.overtime-filter-chip').count(), 3)
    await page.getByRole('button', { name: 'Đặt lại khoảng ngày' }).click()
    assert.equal(await page.locator('.overtime-filter-chip').count(), 2)
    await page.getByRole('button', { name: 'Xóa từ khóa tìm kiếm' }).last().click()
    assert.equal(await page.locator('.overtime-filter-chip').count(), 1, 'clearing the keyword keeps the status filter intact')
    assert.equal(await page.locator('.overtime-status-tabs .leave-tab-btn.active').innerText().then(text => text.includes('Đã duyệt')), true)
    await filterDetails.locator('summary').click()
    await dates.nth(0).fill(fromDate)
    await dates.nth(1).fill(workDate)
    await filterDetails.locator('select').selectOption('2')
    await filterDetails.getByRole('button', { name: 'Áp dụng' }).click()
    assert.equal(await page.locator('.overtime-filter-chip').count(), 3)
    await filterDetails.locator('summary').click()
    await filterDetails.getByRole('button', { name: 'Xóa bộ lọc' }).click()
    assert.equal(await page.locator('.overtime-filter-chip').count(), 1, 'clearing advanced filters retains the status chip')
    assert.equal(await filterDetails.evaluate(el => el.open), false)

    await page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').fill('no-match-xyz')
    await page.getByRole('button', { name: 'Đặt lại bộ lọc' }).waitFor()
    await page.getByRole('button', { name: 'Đặt lại bộ lọc' }).click()
    assert.equal(await page.locator('.overtime-status-tabs .leave-tab-btn.active').innerText().then(text => text.includes('Tất cả')), true)

    await filterDetails.locator('summary').click()
    await dates.nth(0).fill(fromDate)
    await dates.nth(1).fill(workDate)
    await page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').fill('E-31')
    await filterDetails.locator('summary').click()
    await page.locator('.overtime-status-tabs .leave-tab-btn').filter({ hasText: 'Đã duyệt' }).click()
    await filterDetails.locator('summary').click()
    await workspaceTabs.nth(1).click()
    assert.equal(await page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').inputValue(), 'E-31')
    await workspaceTabs.nth(2).click()
    assert.equal(await page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').inputValue(), 'E-31')
    await workspaceTabs.nth(0).click()
    assert.equal(await page.locator('.overtime-status-tabs .leave-tab-btn.active').innerText().then(text => text.includes('Đã duyệt')), true)
    await page.getByRole('button', { name: `Xem chi tiết đơn OT ${requestFixture.request_id}` }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('dialog').getByText(`#${requestFixture.request_id}`).first().waitFor()
    await page.getByRole('dialog').getByRole('button').first().click()
    assert.deepEqual(errors, [])
    console.log('PASS 1280px: 3 workspace tabs, 5 status filters, combined filters, independent chips, reset, tab state and Drawer')

    for (const width of [1440, 1024, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(100)
      await assertNoHorizontalOverflow(page, width)
      if (width === 360) {
        assert.equal(await page.locator('.overtime-status-mobile').isVisible(), true)
        assert.equal(await page.locator('.overtime-status-tabs').isVisible(), false)
        assert.equal(await page.locator('.overtime-request-table').evaluate(el => getComputedStyle(el).display), 'block')
      }
      await filterDetails.locator('summary').click()
      const panel = page.locator('#overtime-advanced-filter-panel')
      const rect = await panel.boundingBox()
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1, `filter panel clipped at ${width}px: ${JSON.stringify(rect)}`)
      await page.keyboard.press('Escape')
      assert.equal(await filterDetails.evaluate(el => el.open), false)
      assert.equal(await filterDetails.locator('summary').evaluate(el => document.activeElement === el), true, 'Escape returns keyboard focus to the filter button')
      await assertNoHorizontalOverflow(page, width)
      console.log(`PASS ${width}px: no page horizontal overflow; filter panel fits and Escape closes it`)
    }
    await page.close()

    const deepLink = await openPage(browser, `/overtime?request_id=${requestFixture.request_id}`)
    await deepLink.page.getByRole('dialog').waitFor()
    assert.match(deepLink.page.url(), /request_id=95001/)
    assert.deepEqual(deepLink.errors, [])
    console.log('PASS deep link: request_id opens the matching detail drawer')
    await deepLink.page.close()

    const emptyTab = await openPage(browser)
    await emptyTab.page.getByLabel('Tìm nhân viên, mã OT, cửa hàng hoặc lý do').fill('nothing-matches')
    await emptyTab.page.getByRole('button', { name: 'Đặt lại bộ lọc' }).waitFor()
    await emptyTab.page.locator('.overtime-workspace-tabs button').nth(1).click()
    await emptyTab.page.getByRole('button', { name: 'Đặt lại bộ lọc' }).waitFor()
    await emptyTab.page.locator('.overtime-workspace-tabs button').nth(2).click()
    await emptyTab.page.getByRole('button', { name: 'Đặt lại bộ lọc' }).waitFor()
    assert.deepEqual(emptyTab.errors, [])
    console.log('PASS empty states: request, reconciliation and history provide reset action')
    await emptyTab.page.close()

    const loadingPage = await openPage(browser, '/overtime', user, { requestListDelayMs: 450 })
    await loadingPage.page.getByText('Đang tải danh sách đơn đăng ký tăng ca...').waitFor()
    await loadingPage.page.locator('.overtime-request-table tbody tr').first().waitFor()
    assert.deepEqual(loadingPage.errors, [])
    console.log('PASS loading state: indicator is visible while the mocked request-list API is delayed')
    await loadingPage.page.close()

    const errorPage = await openPage(browser, '/overtime', user, { requestListError: true })
    await errorPage.page.getByRole('button', { name: 'Đặt lại bộ lọc' }).waitFor()
    assert.ok(await errorPage.page.locator('[data-sonner-toast]').count() > 0, 'HTTP 500 notification should be visible')
    assert.deepEqual(errorPage.errors, [])
    console.log('PASS error state: mocked HTTP 500 is surfaced and the empty view remains recoverable')
    await errorPage.page.close()

    const managerUser = { user_id: 8, employee_id: 28, store_id: 2, username: 'store_manager_fixture', full_name: 'Store Manager Fixture', roles: ['STORE_MANAGER'], permissions: [] }
    const managerPage = await openPage(browser, '/overtime', managerUser)
    assert.equal(await managerPage.page.locator('.overtime-workspace-tabs button').count(), 2, 'Store Manager retains request and history tabs only')
    assert.equal(await managerPage.page.locator('.overtime-workspace-tabs').getByRole('button', { name: /Đối soát OT/ }).count(), 0, 'Store Manager does not receive reconciliation workspace')
    assert.equal(await managerPage.page.getByRole('button', { name: 'Tạo đơn cho nhân viên' }).count(), 1, 'Store Manager retains current create-request UI')
    assert.deepEqual(managerPage.errors, [])
    console.log('PASS Store Manager: no reconciliation workspace; current create-request action remains')
    await managerPage.page.close()

    const employeeUser = { user_id: 31, employee_id: 31, store_id: 2, username: 'employee_fixture', full_name: 'Synthetic Employee', roles: ['EMPLOYEE'], permissions: [] }
    const personalPage = await openPage(browser, '/my-overtime', employeeUser)
    await personalPage.page.getByText('Giờ OT đã xác nhận (kỳ này)').waitFor()
    await personalPage.page.getByText('2.0 giờ', { exact: true }).waitFor()
    assert.equal(await personalPage.page.locator('.overtime-workspace-tabs').count(), 0)
    assert.equal(await personalPage.page.locator('.overtime-filter-fields select').count(), 0, 'employee view has no cross-store selector')
    assert.deepEqual(personalPage.errors, [])
    console.log('PASS /my-overtime: personal KPI counts the verified interval, not a separate unverified request')
    await personalPage.page.close()
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
