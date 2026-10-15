const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/constants/navigation.ts'), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const navigationExports = {}
vm.runInNewContext(output, { exports: navigationExports })
const { navigationForUser, canAccessPath } = navigationExports
const account = (roles, employee_id = 12, store_id = 3) => ({ roles, permissions: [], employee_id, store_id })
const paths = user => navigationForUser(user).map(item => item.path)

assert(paths(account(['ADMIN'])).includes('/users'))
assert(paths(account(['ADMIN'])).includes('/contracts'))
assert(paths(account(['ADMIN'])).includes('/payroll-fund'))
assert(paths(account(['ADMIN'])).includes('/settlements'))
assert(!paths(account(['ADMIN'])).includes('/sales'))
assert(canAccessPath('/sales', account(['ADMIN'])))
assert(!paths(account(['HR_MANAGER'])).includes('/users'))
assert(paths(account(['HR_MANAGER'])).includes('/contracts'))
assert(paths(account(['HR_MANAGER'])).includes('/settlements'))
assert(!paths(account(['HR_MANAGER'])).includes('/sales'))
assert(!paths(account(['STORE_MANAGER'])).includes('/stores'))
assert(paths(account(['STORE_MANAGER'])).includes('/payroll-fund'))
assert(paths(account(['STORE_MANAGER'])).includes('/sales'))
assert(!paths(account(['STORE_MANAGER'])).includes('/settlements'))
assert(!paths(account(['STORE_MANAGER'])).includes('/contracts'))
assert(!paths(account(['STORE_MANAGER'], 12, null)).includes('/attendance'))
assert(!paths(account(['EMPLOYEE'])).includes('/attendance'))
assert(paths(account(['EMPLOYEE'])).includes('/my-payroll'))
assert(paths(account(['EMPLOYEE'])).includes('/projects'))
assert(!paths(account(['EMPLOYEE'], null)).includes('/my-payroll'))
assert(!canAccessPath('/my-attendance', account(['EMPLOYEE'], null)))
assert(!canAccessPath('/users', account(['EMPLOYEE'])))
assert(!paths(account(['ADMIN', 'EMPLOYEE'])).includes('/leave') || paths(account(['ADMIN', 'EMPLOYEE'])).filter(path => path === '/leave').length === 1)
assert.equal(paths(account(['ADMIN', 'EMPLOYEE'])).filter(path => path === '/my-payroll').length, 1)
assert.equal(new Set(paths(account(['ADMIN', 'EMPLOYEE']))).size, paths(account(['ADMIN', 'EMPLOYEE'])).length)
const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
for (const role of ['ADMIN', 'HR_MANAGER', 'STORE_MANAGER', 'EMPLOYEE']) {
  for (const route of new Set(paths(account([role])))) {
    if (route !== '/') assert(app.includes(`path="${route}"`), `Missing route ${route}`)
  }
}
console.log('Navigation/RBAC checks passed')
