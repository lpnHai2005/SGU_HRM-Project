// Kiểm tra tách/ghép địa chỉ nhân viên: node scripts/check-employee-address.mjs
import assert from 'node:assert/strict'
import { composeAddress, parseAddress } from '../src/utils/address.ts'

const full = '123 Nguyễn Huệ, Phường Sài Gòn, Thành phố Hồ Chí Minh'
assert.deepEqual(parseAddress(full), { street: '123 Nguyễn Huệ', ward: 'Phường Sài Gòn', province: 'Thành phố Hồ Chí Minh' })
assert.equal(composeAddress(parseAddress(full)), full)

// Số nhà có dấu phẩy: chỉ 2 phần cuối là phường và tỉnh
assert.deepEqual(parseAddress('Hẻm 5, 12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh').street, 'Hẻm 5, 12 Lê Lợi')

// Không có số nhà
assert.deepEqual(parseAddress('Phường Xuân Hòa, Thành phố Hồ Chí Minh'), { street: '', ward: 'Phường Xuân Hòa', province: 'Thành phố Hồ Chí Minh' })
assert.equal(composeAddress({ street: '  ', ward: 'Phường Xuân Hòa', province: 'Thành phố Hồ Chí Minh' }), 'Phường Xuân Hòa, Thành phố Hồ Chí Minh')

// Chuỗi cũ 1 phần hoặc rỗng
assert.deepEqual(parseAddress('Hà Nội'), { street: 'Hà Nội', ward: '', province: '' })
assert.deepEqual(parseAddress(null), { street: '', ward: '', province: '' })

console.log('employee address helpers OK')
