export type SearchFieldType = 'text' | 'province' | 'number' | 'date' | 'select'

export interface SearchField {
  key: string
  label: string
  type: SearchFieldType
  group: string
  placeholder: string
  sensitive?: boolean
  options?: { label: string; value: string }[]
}

export type SearchCondition = {
  join: 'AND' | 'OR'
  not: boolean
  field: string
  op: string
  value: string
  value2: string
  values: string[]
}

// Bỏ dấu để gõ "nguyen" vẫn khớp "Nguyễn", giống tìm kiếm nhân viên ở backend
const normalizeText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()

const toNumber = (value: unknown) =>
  typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''))

const compare = (item: number, cond: SearchCondition, target: number, target2: number) => {
  if (isNaN(item) || isNaN(target)) return false
  switch (cond.op) {
    case 'neq': return item !== target
    case 'gt': return item > target
    case 'gte': return item >= target
    case 'lt': return item < target
    case 'lte': return item <= target
    case 'between': return item >= target && item <= target2
    default: return item === target
  }
}

const matchesCondition = (row: Record<string, unknown>, cond: SearchCondition, type: SearchFieldType) => {
  const raw = row[cond.field]
  let matched: boolean

  if (type === 'number') {
    matched = compare(toNumber(raw), cond, toNumber(cond.value), toNumber(cond.value2))
  } else if (type === 'date') {
    const toTime = (value: unknown) => new Date(String(value ?? '')).getTime()
    matched = compare(toTime(raw), cond, toTime(cond.value), toTime(cond.value2))
  } else {
    const item = normalizeText(raw)
    const target = normalizeText(cond.value)
    if (cond.op === 'contains') matched = item.includes(target)
    else if (cond.op === 'starts') matched = item.startsWith(target)
    else if (cond.op === 'neq') matched = item !== target
    else matched = item === target
  }

  return cond.not ? !matched : matched
}

// Chỉ giữ trường mà dữ liệu thực sự có, tránh điều kiện luôn ra 0 kết quả
export const fieldsWithData = <T extends { key: string }>(fields: T[], rows: Record<string, unknown>[]) =>
  fields.filter(field => rows.some(row => row[field.key] !== undefined && row[field.key] !== null && row[field.key] !== ''))

// Lọc dữ liệu đã tải sẵn trên trình duyệt theo cùng điều kiện của modal tìm kiếm nâng cao
export const matchesSearchConditions = (
  row: Record<string, unknown>,
  conditions: SearchCondition[],
  fields: SearchField[],
  mode: 'AND' | 'OR'
) => {
  if (conditions.length === 0) return true
  const check = (cond: SearchCondition) =>
    matchesCondition(row, cond, fields.find(field => field.key === cond.field)?.type || 'text')
  return mode === 'AND' ? conditions.every(check) : conditions.some(check)
}
