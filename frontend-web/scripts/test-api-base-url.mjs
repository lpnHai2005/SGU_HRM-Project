import assert from 'node:assert/strict'
import { resolveApiBaseUrl } from '../src/services/apiBaseUrl.ts'

assert.equal(resolveApiBaseUrl(undefined, 'localhost', true), '/api/v1')
assert.equal(
  resolveApiBaseUrl('http://localhost:8000/api/v1', 'localhost', true),
  'http://localhost:8000/api/v1',
)
assert.equal(
  resolveApiBaseUrl('http://localhost:8000/api/v1', '192.168.1.50', true),
  '/api/v1',
)
assert.equal(
  resolveApiBaseUrl('http://127.0.0.1:8000/api/v1', '192.168.1.50', true),
  '/api/v1',
)
assert.equal(
  resolveApiBaseUrl('https://api.example.test/api/v1', '192.168.1.50', true),
  'https://api.example.test/api/v1',
)
assert.equal(
  resolveApiBaseUrl('http://localhost:8000/api/v1', '192.168.1.50', false),
  'http://localhost:8000/api/v1',
)

console.log('PASS API base URL resolver: 6/6')
