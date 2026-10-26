const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core')
const assert = require('node:assert/strict')

const origin = process.env.MOBILE_LOGIN_TEST_ORIGIN || 'http://127.0.0.2:3000'
const mode = process.argv.includes('--before') ? 'before' : 'after'
const viewports = [
  { width: 360, height: 800, isMobile: true },
  { width: 375, height: 812, isMobile: true },
  { width: 390, height: 844, isMobile: true },
  { width: 414, height: 896, isMobile: true },
  { width: 768, height: 1024, isMobile: true },
  { width: 1280, height: 900, isMobile: false },
]

const user = {
  user_id: 900001,
  username: 'synthetic_mobile_probe',
  full_name: 'Synthetic Mobile User',
  roles: ['ADMIN'],
  permissions: [],
  employee_id: null,
  store_id: null,
  store_name: null,
}

const profile = {
  ...user,
  email: null,
  phone: null,
  is_active: true,
  employee_code: null,
  department_name: null,
  position_name: null,
}

function response(status, body) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installSyntheticAuthRoutes(page) {
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path.endsWith('/__mobile_proxy_probe__')) return route.continue()
    if (path.endsWith('/auth/test-accounts')) return route.fulfill(response(200, []))
    if (path.endsWith('/auth/login') && request.method() === 'POST') {
      if (mode === 'before') return route.abort('failed')
      const payload = request.postDataJSON() || {}
      if (payload.username === 'synthetic_bad_login') {
        return route.fulfill(response(401, { detail: 'Tên đăng nhập hoặc mật khẩu không chính xác.' }))
      }
      return route.fulfill(response(200, {
        access_token: 'synthetic-browser-token',
        token_type: 'bearer',
        ...user,
      }))
    }
    if (path.endsWith('/auth/me')) return route.fulfill(response(200, profile))
    if (path.endsWith('/reports/dashboard-stats')) {
      return route.fulfill(response(200, {
        active_employees: 0,
        pending_leaves: 0,
        attendance_today: { checked_in: 0, working: 0, late: 0 },
        monthly_net_payroll_fund: 0,
        monthly_gross_payroll_fund: 0,
        total_retail_revenue: 0,
      }))
    }
    if (path.endsWith('/leaves/summary/stats')) return route.fulfill(response(200, {}))
    return route.fulfill(response(200, []))
  })
}

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const results = []
  try {
    for (const viewport of viewports) {
      const { isMobile, ...size } = viewport
      const context = await browser.newContext({ viewport: size, isMobile, hasTouch: isMobile })
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      const requests = []
      const loginStatuses = []
      const apiPaths = []
      const jsErrors = []
      page.on('pageerror', error => jsErrors.push(error.message))
      page.on('request', request => {
        const requestUrl = new URL(request.url())
        if (requestUrl.pathname.startsWith('/api/v1/')) apiPaths.push(requestUrl.pathname)
        if (request.url().includes('/api/v1/auth/login') && request.method() === 'POST') {
          const payload = request.postDataJSON() || {}
          requests.push({
            url: request.url(),
            method: request.method(),
            contentType: request.headers()['content-type'],
            bodyFields: Object.keys(payload).sort(),
          })
        }
      })
      page.on('response', response => {
        if (response.url().includes('/api/v1/auth/login') && response.request().method() === 'POST') {
          loginStatuses.push(response.status())
        }
      })
      await installSyntheticAuthRoutes(page)
      const navigation = await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 12000 })
      if (!navigation?.ok()) throw new Error(`Login page did not load: ${navigation?.status() ?? 'no response'}`)
      await page.locator('#username').waitFor()
      const loginLayout = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        formVisible: Boolean(document.querySelector('.login-form')?.getBoundingClientRect().height),
        buttonVisible: Boolean(document.querySelector('button[type="submit"]')?.getBoundingClientRect().height),
      }))
      assert(loginLayout.formVisible && loginLayout.buttonVisible, `login form and submit button visible at ${viewport.width}px`)
      assert(loginLayout.documentWidth <= loginLayout.width, `login page has no horizontal overflow at ${viewport.width}px`)
      if (viewport.width === 390 && mode === 'after') {
        const proxyProbe = await page.evaluate(async () => {
          const response = await fetch('/api/v1/__mobile_proxy_probe__', { headers: { Accept: 'application/json' } })
          return { status: response.status, contentType: response.headers.get('content-type') }
        })
        assert.match(proxyProbe.contentType || '', /application\/json/i, 'GET reached FastAPI through Vite proxy')
        results.push({ proxy_probe: proxyProbe, live_auth_write: 'NOT_RUN' })
      }
      await page.locator('#username').fill('synthetic_mobile_probe')
      await page.locator('#password').fill('synthetic-only')
      await page.locator('button[type="submit"]').click()

      if (mode === 'before') {
        await page.locator('.alert-error').waitFor()
        assert.match(requests[0]?.url || '', /^http:\/\/localhost:8000\/api\/v1\/auth\/login$/)
        results.push({ viewport, login_request: requests[0], outcome: 'network request targets localhost API and fails' })
      } else {
        await page.locator('.app-layout').waitFor()
        assert.equal(requests.length, 1, 'exactly one login POST per submit')
        assert.match(requests[0].contentType || '', /application\/json/i)
        assert.deepEqual(requests[0].bodyFields, ['password', 'username'])
        assert.equal(new URL(requests[0].url).origin, origin, 'login uses Vite same-origin proxy')
        assert.equal(new URL(requests[0].url).pathname, '/api/v1/auth/login')
        assert.deepEqual(loginStatuses, [200], 'synthetic backend returned HTTP 200 through Vite proxy')
        assert.equal(await page.evaluate(() => localStorage.getItem('hrm_token')), 'synthetic-browser-token')
        await page.reload()
        await page.locator('.app-layout').waitFor()
        assert.equal(new URL(page.url()).pathname, '/', 'refresh restores authenticated dashboard')
        assert(apiPaths.includes('/api/v1/auth/me'), 'refresh verifies restored session through /auth/me')
        await page.goto(`${origin}/overtime`)
        await page.locator('.app-layout').waitFor()
        assert.equal(new URL(page.url()).pathname, '/overtime', 'OT route remains authenticated')
        const dimensions = await page.evaluate(() => ({
          width: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          loginVisible: Boolean(document.querySelector('.app-layout')),
        }))
        assert(dimensions.documentWidth <= dimensions.width, `no horizontal page overflow at ${viewport.width}px`)
        assert.equal(jsErrors.length, 0, `no uncaught JavaScript errors at ${viewport.width}px`)
        results.push({ viewport, login_request: requests[0], refresh_restored: true, ot_route_loaded: true, ...dimensions })
      }
      await context.close()
    }

    if (mode === 'after') {
      const context = await browser.newContext({ viewport: viewports[2], isMobile: true, hasTouch: true })
      const page = await context.newPage()
      await page.route('**/api/v1/auth/login', route => route.abort('failed'))
      await page.goto(`${origin}/login`)
      await page.locator('#username').fill('synthetic_mobile_probe')
      await page.locator('#password').fill('synthetic-only')
      await page.locator('button[type="submit"]').click()
      await page.locator('.alert-error').waitFor()
      assert.match(await page.locator('.alert-error').innerText(), /Không thể kết nối máy chủ/)
      await context.close()

      const badLoginContext = await browser.newContext({ viewport: viewports[2], isMobile: true, hasTouch: true })
      const badLoginPage = await badLoginContext.newPage()
      await badLoginPage.goto(`${origin}/login`)
      await badLoginPage.locator('#username').fill('synthetic_bad_login')
      await badLoginPage.locator('#password').fill('wrong-synthetic-only')
      await badLoginPage.locator('button[type="submit"]').click()
      await badLoginPage.locator('.alert-error').waitFor()
      assert.match(await badLoginPage.locator('.alert-error').innerText(), /Tên đăng nhập hoặc mật khẩu không chính xác/)
      await badLoginContext.close()
    }
    console.log(JSON.stringify({ mode, origin, results }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
