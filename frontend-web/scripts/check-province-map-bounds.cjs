const fs = require('node:fs')
const path = require('node:path')

const dataDir = path.join(__dirname, '..', 'public', 'data')
const srcDir = path.join(__dirname, '..', 'src')
const parseJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const provinces = parseJson(path.join(dataDir, 'province.json'))
const mapData = parseJson(path.join(dataDir, 'province-map-bounds.json'))
const bounds = mapData.provinces

if (provinces.length !== 34) throw new Error(`Expected province.json to contain 34 areas, got ${provinces.length}`)
if (bounds.length !== provinces.length) throw new Error(`Expected ${provinces.length} map bounds, got ${bounds.length}`)
if (!mapData.source_url || !mapData.attribution) throw new Error('Map bounds must include source attribution')

const byCode = new Map()
for (const item of bounds) {
  if (byCode.has(item.code)) throw new Error(`Duplicate map bounds for code ${item.code}`)
  if (!Array.isArray(item.bbox) || item.bbox.length !== 4 || !item.bbox.every(Number.isFinite)) throw new Error(`Invalid bbox for code ${item.code}`)
  const [west, south, east, north] = item.bbox
  if (west < 100 || east > 112 || south < 7 || north > 24 || west >= east || south >= north) throw new Error(`Out-of-range or inverted bbox for code ${item.code}`)
  byCode.set(item.code, item)
}

for (const province of provinces) {
  const boundary = byCode.get(province.code)
  if (!boundary) throw new Error(`Missing map bounds for ${province.name} (${province.code})`)
  if (boundary.name !== province.name) throw new Error(`Province name/code mismatch for ${province.code}: ${boundary.name} != ${province.name}`)
}

const knownRegions = [
  { code: 1, lon: [105, 107], lat: [20, 22] },
  { code: 48, lon: [107, 110], lat: [14, 17] },
  { code: 79, lon: [106, 108], lat: [10, 13] },
]
for (const sample of knownRegions) {
  const [west, south, east, north] = byCode.get(sample.code).bbox
  if (west < sample.lon[0] || east > sample.lon[1] || south < sample.lat[0] || north > sample.lat[1]) throw new Error(`Known-region bbox check failed for code ${sample.code}`)
}

const pickerSource = fs.readFileSync(path.join(srcDir, 'components', 'StoreLocationStep.tsx'), 'utf8')
const mapSource = fs.readFileSync(path.join(srcDir, 'components', 'StoreMapPicker.tsx'), 'utf8')
const pageSource = fs.readFileSync(path.join(srcDir, 'pages', 'StoreManagementPage.tsx'), 'utf8')
if (/poi-search|reverse-geocode|Reverse Geocod|Tìm POI|Tìm kiếm/i.test(pickerSource)) throw new Error('Store location step still contains Search/Reverse UI or caller')
if (/poi-search|reverse-geocode/.test(mapSource)) throw new Error('Map picker still contains Search/Reverse caller')
if (/address:\s*location\.address|district:\s*location\.district|city:\s*location\.city/.test(pageSource)) throw new Error('Confirming the map pin must not overwrite the manually entered address')
if (!/fitBounds\(/.test(mapSource)) throw new Error('Province navigation must fit boundary bounds')

console.log(`PASS: ${provinces.length} province codes match valid sourced map bounds; Hanoi, Da Nang, and Ho Chi Minh City bounds verified. No Search/Reverse caller or address autofill remains in the map flow.`)
