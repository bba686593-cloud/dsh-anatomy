import { deflateSync, inflateSync } from 'node:zlib'
import { imageCaptionHeight, parseImageSource } from './images.js'
import { surfaceErasureDiagnostics } from './surface.js'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const channelsFor = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]])
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1
  return value >>> 0
})
function chunk(name, data) {
  const result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, result.length - 4)) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
  return da <= db && da <= dc ? a : db <= dc ? b : c
}

// Decode the static image represented by ordinary browser PNG exports. Palette
// and grayscale sources are accepted too; unsupported formats fail explicitly.
export function decodePng(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input.slice(input.indexOf(',') + 1), 'base64') : input
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) throw Error('PNG 文件无效。')
  let width, height, depth, type, palette, transparency, ended = false
  const payload = []
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), end = at + length + 12, name = bytes.toString('ascii', at + 4, at + 8)
    if (end > bytes.length) throw Error('PNG 文件不完整。')
    const data = bytes.subarray(at + 8, end - 4)
    if (name === 'IHDR') {
      if (at !== 8 || length !== 13) throw Error('PNG 尺寸头无效。')
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]
      if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) throw Error('PNG 尺寸过大。')
      if (data[10] || data[11] || data[12]) throw Error('暂不支持交错 PNG 的局部擦除预览。')
      const allowed = type === 0 ? [1, 2, 4, 8, 16] : type === 3 ? [1, 2, 4, 8] : [8, 16]
      if (!channelsFor.has(type) || !allowed.includes(depth)) throw Error('PNG 颜色格式暂不支持局部擦除预览。')
    } else if (name === 'PLTE') palette = data
    else if (name === 'tRNS') transparency = data
    else if (name === 'IDAT') payload.push(data)
    else if (name === 'IEND') { ended = true; break }
    at = end
  }
  if (!width || !ended || !payload.length) throw Error('PNG 缺少完整图像数据。')
  if (type === 3 && (!palette?.length || palette.length % 3 || palette.length > 768)) throw Error('PNG 调色板无效。')
  const channels = channelsFor.get(type), stride = Math.ceil(width * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8)), expected = (stride + 1) * height
  const inflated = inflateSync(Buffer.concat(payload), { maxOutputLength: expected })
  if (inflated.length !== expected) throw Error('PNG 像素长度无效。')
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)], start = y * stride
    if (filter > 4) throw Error('PNG 滤波方式无效。')
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? rows[start + x - bpp] : 0, up = y ? rows[start + x - stride] : 0, corner = y && x >= bpp ? rows[start + x - stride - bpp] : 0
      rows[start + x] = (inflated[y * (stride + 1) + x + 1] + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0)) & 255
    }
  }
  const pixels = Buffer.alloc(width * height * 4), maxSample = 2 ** depth - 1
  const sample = (row, index) => depth === 16 ? rows.readUInt16BE(row + index * 2) : depth === 8 ? rows[row + index] : rows[row + Math.floor(index * depth / 8)] >> (8 - depth - index * depth % 8) & maxSample
  const byte = n => Math.round(n * 255 / maxSample)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = y * stride, offset = (y * width + x) * 4, base = x * channels, a = sample(row, base)
    let r, g, b, alpha = 255
    if (type === 3) {
      if (a * 3 + 2 >= palette.length) throw Error('PNG 调色板索引无效。')
      r = palette[a * 3]; g = palette[a * 3 + 1]; b = palette[a * 3 + 2]; alpha = transparency?.[a] ?? 255
    } else if (type === 0 || type === 4) {
      r = g = b = byte(a)
      if (type === 4) alpha = byte(sample(row, base + 1))
      else if (transparency?.length === 2 && a === transparency.readUInt16BE(0)) alpha = 0
    } else {
      const green = sample(row, base + 1), blue = sample(row, base + 2)
      r = byte(a); g = byte(green); b = byte(blue)
      if (type === 6) alpha = byte(sample(row, base + 3))
      else if (transparency?.length === 6 && a === transparency.readUInt16BE(0) && green === transparency.readUInt16BE(2) && blue === transparency.readUInt16BE(4)) alpha = 0
    }
    pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b; pixels[offset + 3] = alpha
  }
  return { width, height, data: pixels }
}

export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 40000000 || data?.length !== width * height * 4) throw Error('PNG 像素尺寸无效。')
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function resizeForDisplay(source, drawW, drawH) {
  // Masks describe the displayed carrier, whose holes can be much smaller
  // than a source pixel. Rasterize at up to 2x display density before erasing.
  let factor = Math.min(Math.max(1, Math.min(2 * drawW / source.width, 2 * drawH / source.height)), 4096 / source.width, 4096 / source.height, Math.sqrt(4194304 / (source.width * source.height)))
  if (factor > 1) factor = Math.pow(Math.SQRT2, Math.floor(Math.log(factor) / Math.log(Math.SQRT2)))
  const width = Math.max(1, Math.floor(source.width * factor)), height = Math.max(1, Math.floor(source.height * factor))
  if (width === source.width && height === source.height) return source
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(source.height - 1, (y + .5) * source.height / height - .5)), y0 = Math.floor(sy), y1 = Math.min(source.height - 1, y0 + 1), fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, (x + .5) * source.width / width - .5)), x0 = Math.floor(sx), x1 = Math.min(source.width - 1, x0 + 1), fx = sx - x0
      const indices = [(y0 * source.width + x0) * 4, (y0 * source.width + x1) * 4, (y1 * source.width + x0) * 4, (y1 * source.width + x1) * 4], weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], at = (y * width + x) * 4
      let alpha = 0
      const colors = [0, 0, 0]
      for (let i = 0; i < 4; i++) { const weight = weights[i] * source.data[indices[i] + 3]; alpha += weight; for (let channel = 0; channel < 3; channel++) colors[channel] += source.data[indices[i] + channel] * weight }
      for (let channel = 0; channel < 3; channel++) data[at + channel] = alpha ? Math.round(colors[channel] / alpha) : 0
      data[at + 3] = Math.round(alpha)
    }
  }
  return { width, height, data }
}

const previews = new Map(), previewBudget = 16 * 1024 * 1024
let previewBytes = 0
export function maskedImageSource(element) {
  const errors = surfaceErasureDiagnostics(element)
  if (errors.length) throw Error(errors[0].message)
  const src = element.image?.src, strokes = (element.erasures || []).filter(stroke => (stroke.surface || 'body') === 'body')
  if (!strokes.length) return src
  const parsed = parseImageSource(src)
  if (parsed.mime !== 'image/png') throw Error('这张图片有局部擦除；当前 MCP 仅能预览擦除后的 PNG，未发送未擦除的原图。')
  const key = JSON.stringify([src, strokes, element.width, element.height, element.formulaGraphic ? null : imageCaptionHeight(element)])
  if (previews.has(key)) { const cached = previews.get(key); previews.delete(key); previews.set(key, cached); return cached }
  const source = decodePng(src), w = Math.max(1, element.width || source.width), h = Math.max(1, element.height || source.height)
  const viewportHeight = element.formulaGraphic ? h : Math.max(20, h - imageCaptionHeight(element))
  const scale = Math.min(w / source.width, viewportHeight / source.height), drawW = element.formulaGraphic ? w : source.width * scale, drawH = element.formulaGraphic ? h : source.height * scale
  const image = resizeForDisplay(source, drawW, drawH)
  const ux = (w - drawW) / 2 / w, vy = (viewportHeight - drawH) / 2 / h, sx = drawW / image.width / w, sy = drawH / image.height / h
  for (const stroke of strokes) {
    const [rx, ry] = stroke.radius
    for (let index = 0; index < stroke.points.length; index++) {
      const a = stroke.points[Math.max(0, index - 1)], b = stroke.points[index], dx = (b[0] - a[0]) / rx, dy = (b[1] - a[1]) / ry, length = dx * dx + dy * dy
      const left = Math.max(0, Math.floor((Math.min(a[0], b[0]) - rx - ux) / sx)), right = Math.min(image.width - 1, Math.ceil((Math.max(a[0], b[0]) + rx - ux) / sx))
      const top = Math.max(0, Math.floor((Math.min(a[1], b[1]) - ry - vy) / sy)), bottom = Math.min(image.height - 1, Math.ceil((Math.max(a[1], b[1]) + ry - vy) / sy))
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const px = (ux + (x + .5) * sx - a[0]) / rx, py = (vy + (y + .5) * sy - a[1]) / ry, t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0
        if ((px - t * dx) ** 2 + (py - t * dy) ** 2 <= 1) image.data[(y * image.width + x) * 4 + 3] = 0
      }
    }
  }
  const output = 'data:image/png;base64,' + encodePng(image).toString('base64')
  parseImageSource(output)
  if ((key.length + output.length) * 2 <= previewBudget) {
    previews.set(key, output); previewBytes += (key.length + output.length) * 2
    while (previewBytes > previewBudget) { const first = previews.keys().next().value; previewBytes -= (first.length + previews.get(first).length) * 2; previews.delete(first) }
  }
  return output
}
