// Kiểm tra lọc theo điều kiện tìm kiếm nâng cao: node scripts/check-search-conditions.mjs
import assert from 'node:assert/strict'
import { fieldsWithData, matchesSearchConditions } from '../src/utils/searchConditions.ts'

const fields = [
  { key: 'name', label: 'Tên', type: 'text', group: 'A', placeholder: '' },
  { key: 'salary', label: 'Lương', type: 'number', group: 'A', placeholder: '' },
  { key: 'joined', label: 'Ngày vào', type: 'date', group: 'A', placeholder: '' },
  { key: 'store', label: 'Cửa hàng', type: 'select', group: 'A', placeholder: '' },
]
const row = { name: 'Nguyễn Văn Đức', salary: '12000000.00', joined: '2026-03-15', store: 'Quận 1' }
const cond = (field, op, value, extra = {}) => ({ join: 'AND', not: false, field, op, value, value2: '', values: [], ...extra })
const match = (conditions, mode = 'AND') => matchesSearchConditions(row, conditions, fields, mode)

assert.equal(match([]), true)

// Văn bản: không phân biệt dấu và hoa thường
assert.equal(match([cond('name', 'contains', 'van duc')]), true)
assert.equal(match([cond('name', 'starts', 'NGUYEN')]), true)
assert.equal(match([cond('name', 'eq', 'nguyen van duc')]), true)
assert.equal(match([cond('name', 'neq', 'nguyen van duc')]), false)
assert.equal(match([cond('name', 'contains', 'duc', { not: true })]), false)

// Số, kể cả chuỗi số từ API và khoảng giá trị
assert.equal(match([cond('salary', 'gte', '12000000')]), true)
assert.equal(match([cond('salary', 'gt', '12000000')]), false)
assert.equal(match([cond('salary', 'between', '10000000', { value2: '15000000' })]), true)
assert.equal(match([cond('salary', 'between', '13000000', { value2: '15000000' })]), false)

// Ngày
assert.equal(match([cond('joined', 'lt', '2026-04-01')]), true)
assert.equal(match([cond('joined', 'between', '2026-01-01', { value2: '2026-02-01' })]), false)

// Danh mục và chế độ kết hợp
assert.equal(match([cond('store', 'eq', 'quận 1')]), true)
assert.equal(match([cond('store', 'neq', 'Quận 1')]), false)
const mixed = [cond('store', 'eq', 'Quận 3'), cond('salary', 'gte', '1')]
assert.equal(match(mixed, 'AND'), false)
assert.equal(match(mixed, 'OR'), true)

// Trường không có trong dữ liệu hoặc toàn rỗng thì bị bỏ, giá trị 0 vẫn giữ
const keys = (rows) => fieldsWithData([{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }], rows).map(field => field.key)
assert.deepEqual(keys([{ a: 'x', b: null, c: '' }, { a: 'y' }]), ['a'])
assert.deepEqual(keys([{ a: 0, d: null }, { d: 5 }]), ['a', 'd'])
assert.deepEqual(keys([]), [])

console.log('search condition helpers OK')
