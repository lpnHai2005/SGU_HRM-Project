// Browser acceptance for the OT approval conflict preflight.
// Every API response is synthetic and intercepted; this script never contacts a database.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appOrigin = process.env.OT_UI_BASE_URL || 'http://127.0.0.1:3176'
const evidencePath = path.resolve(__dirname, '../../backend/fixtures/evidence/mission9-cp49-conflict-warning-browser.json')
const user = {
  user_id: 40,
  username: 'synthetic_hr',
  full_name: 'Synthetic HR Reviewer',
  roles: ['HR_MANAGER'],
  permissions: [],
  employee_id: 400,
  store_id: 4,
  store_name: 'Synthetic Branch',
}

const schedule = {
  schedule_id: 91,
  work_date: '2026-10-20',
  shift_name: 'Synthetic Evening Shift',
  starts_at: '2026-10-20T17:00:00+07:00',
  ends_at: '2026-10-20T21:00:00+07:00',
  overlaps_overtime: true,
}

function requestFor(id, approvalContext, start = '18:00', end = '20:00') {
  return {
    request_id: id,
    employee_id: 401,
    employee_name: 'Synthetic Employee',
    employee_code: 'SYN-401',
    store_id: 4,
    store_name: 'Synthetic Branch',
    work_date: '2026-10-20',
    starts_at: `2026-10-20T${start}:00+07:00`,
    ends_at: `2026-10-20T${end}:00+07:00`,
    reason: 'Synthetic browser acceptance only',
    status: 'PENDING_HR',
    request_type: 'STANDARD',
    created_by: 41,
    creator_username: 'synthetic_manager',
    events: [],
    ...(approvalContext === 'OMIT' ? {} : { approval_context: approvalContext }),
  }
}

function contextWithConflicts() {
  return {
    related_schedules: [schedule],
    conflicts: [
      { code: 'WORK_SCHEDULE_CONFLICT', message: 'Synthetic schedule overlap', schedule_id: schedule.schedule_id },
      { code: 'OVERTIME_REQUEST_CONFLICT', message: 'Synthetic duplicate OT', request_id: 92 },
      { code: 'LEAVE_CONFLICT', message: 'Synthetic leave overlap', leave_request_id: 93 },
    ],
  }
}

async function openRequest(browser, id, getDetail, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  const pageErrors = []
  const apiStatuses = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(value => {
    localStorage.setItem('hrm_token', 'synthetic-browser-token')
    localStorage.setItem('hrm_user', JSON.stringify(value))
  }, user)
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    let data = []

    if (pathname.endsWith('/auth/me')) data = user
    else if (pathname.endsWith('/overtime-reconciliations')) data = []
    else if (pathname.endsWith('/overtime-requests/count')) data = { count: 1 }
    else if (/\/overtime-requests\/\d+$/.test(pathname)) data = getDetail()
    else if (pathname.endsWith('/overtime-requests')) data = [getDetail()]
    else if (pathname.endsWith('/employees/lookups')) data = { stores: [], employees: [] }
    else if (pathname.endsWith('/employees')) data = []

    apiStatuses.push({ path: pathname, status: 200 })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto(`${appOrigin}/overtime?request_id=${id}`, { waitUntil: 'networkidle' })
  const drawer = page.getByRole('dialog', { name: `OT #${id}` })
  await drawer.waitFor({ state: 'visible' })
  return { page, drawer, pageErrors, apiStatuses }
}

function assertWarningLayout(page, drawer, width) {
  return Promise.all([
    drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
    page.locator('.overtime-conflict-warning').first().evaluate(el => {
      const rect = el.getBoundingClientRect()
      return rect.left >= -1 && rect.right <= window.innerWidth + 1
    }),
  ]).then(([drawerFits, warningFits]) => {
    assert.equal(drawerFits, true, `drawer overflow at ${width}px`)
    assert.equal(warningFits, true, `warning escapes viewport at ${width}px`)
  })
}

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const results = []
  try {
    const conflict = requestFor(491, contextWithConflicts())
    const conflictAtDesktop = await openRequest(browser, 491, () => conflict, 1440)
    const conflictWarning = conflictAtDesktop.page.locator('.overtime-conflict-warning')
    await conflictWarning.waitFor({ state: 'visible' })
    assert.equal(await conflictAtDesktop.page.locator('.overtime-request-conflict-list li').count(), 3)
    assert.equal(await conflictAtDesktop.page.locator('.overtime-no-conflict').count(), 0)
    assert((await conflictWarning.innerText()).includes('Synthetic schedule overlap'))
    assert((await conflictWarning.innerText()).includes('Synthetic duplicate OT'))
    assert((await conflictWarning.innerText()).includes('Synthetic leave overlap'))
    results.push({ case: 'conflicts_schedule_duplicate_leave', result: 'PASS', viewport: 1440 })
    await conflictAtDesktop.page.close()

    const noConflict = requestFor(492, { related_schedules: [], conflicts: [] })
    const noConflictPage = await openRequest(browser, 492, () => noConflict, 1440)
    await noConflictPage.page.locator('.overtime-no-conflict').waitFor({ state: 'visible' })
    assert.equal(await noConflictPage.page.locator('.overtime-conflict-warning').count(), 0)
    results.push({ case: 'complete_check_no_conflicts', result: 'PASS', viewport: 1440 })
    await noConflictPage.page.close()

    const missing = requestFor(493, 'OMIT')
    const missingPage = await openRequest(browser, 493, () => missing, 1440)
    await missingPage.page.locator('.overtime-conflict-warning').waitFor({ state: 'visible' })
    assert.equal(await missingPage.page.locator('.overtime-no-conflict').count(), 0)
    assert((await missingPage.page.locator('.overtime-conflict-warning').innerText()).includes('Chưa tải được kết quả kiểm tra xung đột'))
    results.push({ case: 'missing_check_context_fails_closed', result: 'PASS', viewport: 1440 })
    await missingPage.page.close()

    const malformed = requestFor(494, { related_schedules: [] })
    const malformedPage = await openRequest(browser, 494, () => malformed, 1440)
    await malformedPage.page.locator('.overtime-conflict-warning').waitFor({ state: 'visible' })
    assert.equal(await malformedPage.page.locator('.overtime-no-conflict').count(), 0)
    assert.equal(malformedPage.pageErrors.length, 0, 'partial context must not crash drawer')
    results.push({ case: 'partial_check_context_fails_closed_without_crash', result: 'PASS', viewport: 1440 })
    await malformedPage.page.close()

    let changed = requestFor(495, { related_schedules: [], conflicts: [] }, '18:00', '20:00')
    const changedPage = await openRequest(browser, 495, () => changed, 1440)
    await changedPage.page.locator('.overtime-no-conflict').waitFor({ state: 'visible' })
    const beforeText = await changedPage.page.locator('.overtime-detail-grid').innerText()
    assert(beforeText.includes('18:00'))
    changed = requestFor(495, {
      related_schedules: [schedule],
      conflicts: [{ code: 'WORK_SCHEDULE_CONFLICT', message: 'Synthetic conflict after OT time change', schedule_id: schedule.schedule_id }],
    }, '18:30', '20:30')
    await changedPage.page.reload({ waitUntil: 'networkidle' })
    await changedPage.page.locator('.overtime-conflict-warning').waitFor({ state: 'visible' })
    const afterText = await changedPage.page.locator('.overtime-detail-grid').innerText()
    assert(afterText.includes('18:30') && afterText.includes('20:30'))
    assert((await changedPage.page.locator('.overtime-conflict-warning').innerText()).includes('Synthetic conflict after OT time change'))
    results.push({ case: 'changed_ot_time_refetches_conflict_context', result: 'PASS', viewport: 1440 })
    await changedPage.page.close()

    for (const width of [1440, 1024, 768, 360]) {
      for (const [id, detail, label] of [
        [500 + width, requestFor(500 + width, contextWithConflicts()), 'conflict'],
        [600 + width, requestFor(600 + width, 'OMIT'), 'missing_context'],
      ]) {
        const responsive = await openRequest(browser, id, () => detail, width)
        await responsive.page.locator('.overtime-conflict-warning').waitFor({ state: 'visible' })
        await assertWarningLayout(responsive.page, responsive.drawer, width)
        assert.equal(await responsive.page.locator('.overtime-no-conflict').count(), 0)
        assert.equal(responsive.pageErrors.length, 0)
        results.push({ case: `responsive_${label}`, result: 'PASS', viewport: width })
        await responsive.page.close()
      }
    }

    const output = {
      generated_at: new Date().toISOString(),
      environment: 'local Vite + real Chrome; all /api responses synthetic/intercepted; no database connection',
      browser: 'Google Chrome headless via Playwright Core',
      base_url: appOrigin,
      tests_run: results.length,
      pass: results.filter(item => item.result === 'PASS').length,
      fail: results.filter(item => item.result === 'FAIL').length,
      results,
    }
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
    fs.writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(`PASS: ${output.pass}/${output.tests_run} OT conflict warning browser assertions (synthetic API only).`)
    console.log(`Evidence: ${path.relative(process.cwd(), evidencePath)}`)
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
