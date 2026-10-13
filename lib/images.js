// Shared by the browser and the server. Embedded raster data is inert and
// self-contained; paths, remote URLs and SVG are deliberately unsupported.
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_BOARD_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_BOARD_REQUEST_BYTES = 12 * 1024 * 1024
const IMAGE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function imageCaptionHeight(element) {
  const font=element.fontSize||16,columns=Math.max(1,Math.floor(Math.max(1,element.width-24)/(font*.9)))
  const text=String(element.text||element.image?.alt||''),lines=text.split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(Array.from(line).length/columns)),0)
  const math=(typeof element.math==='string'&&element.math.trim()?1:0)+(Array.isArray(element.mathExpressions)?element.mathExpressions.filter(f=>typeof f?.value==='string'&&f.value.trim()).length:0)
  return Math.max(40,Math.ceil(lines*font*1.6+math*50+24))
}

export function parseImageSource(src) {
  if (typeof src !== 'string') throw Error('图片需要内嵌 PNG、JPEG 或 WebP 数据。')
  const header = /^data:image\/(png|jpeg|webp);base64,/.exec(src)
  if (!header) throw Error('图片只允许内嵌 PNG、JPEG 或 WebP，不能使用网址、SVG 或脚本。')
  const data = src.slice(header[0].length), padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  if(data.length>Math.ceil(MAX_IMAGE_BYTES/3)*4)throw Error('单张图片不能超过 6 MiB，请压缩后插入。')
  if (!data.length || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data) || (data.includes('=') && data.indexOf('=') !== data.length - padding)) throw Error('图片的 base64 数据无效。')
  const last = IMAGE_ALPHABET.indexOf(data[data.length - padding - 1])
  if ((padding === 2 && (last & 15)) || (padding === 1 && (last & 3))) throw Error('图片的 base64 数据无效。')
  const bytes = data.length / 4 * 3 - padding
  if (bytes > MAX_IMAGE_BYTES) throw Error('单张图片不能超过 6 MiB，请压缩后插入。')
  // Read header/container bytes directly from base64, without allocating a
  // decoded image or requiring Node-only Buffer inside the generated HTML.
  const byte = index => {
    if (index < 0 || index >= bytes) throw Error('图片文件不完整。')
    const start = Math.floor(index / 3) * 4, offset = index % 3
    const a = IMAGE_ALPHABET.indexOf(data[start + offset]), b = IMAGE_ALPHABET.indexOf(data[start + offset + 1])
    return offset === 0 ? (a << 2) | (b >> 4) : offset === 1 ? ((a & 15) << 4) | (b >> 2) : ((a & 3) << 6) | b
  }
  const u16 = index => byte(index) * 256 + byte(index + 1)
  const u32 = index => byte(index) * 0x1000000 + byte(index + 1) * 0x10000 + byte(index + 2) * 256 + byte(index + 3)
  const le24 = index => byte(index) + byte(index + 1) * 256 + byte(index + 2) * 0x10000
  const le32 = index => le24(index) + byte(index + 3) * 0x1000000
  const tag = (index, value) => [...value].every((c, n) => byte(index + n) === c.charCodeAt(0))
  let width, height
  if (header[1] === 'png') {
    if (bytes < 45 || ![137,80,78,71,13,10,26,10].every((v, n) => byte(n) === v) || u32(8) !== 13 || !tag(12, 'IHDR')) throw Error('PNG 文件签名或尺寸头无效。')
    width = u32(16); height = u32(20)
    let position = 8, pixels = false, finished = false
    while (position + 12 <= bytes) {
      const length = u32(position), end = position + 12 + length
      if (end > bytes) throw Error('PNG 文件不完整。')
      if (tag(position + 4, 'IDAT') && length) pixels = true
      if (tag(position + 4, 'IEND')) { if (length || end !== bytes) throw Error('PNG 文件结尾无效。'); finished = true; break }
      position = end
    }
    if (!pixels || !finished) throw Error('PNG 文件缺少图像数据或完整结尾。')
  } else if (header[1] === 'jpeg') {
    if (bytes < 4 || byte(0) !== 255 || byte(1) !== 216 || byte(bytes - 2) !== 255 || byte(bytes - 1) !== 217) throw Error('JPEG 文件签名或结尾无效。')
    let position = 2, scan = false
    while (position + 3 < bytes) {
      if (byte(position++) !== 255) throw Error('JPEG 文件段无效。')
      while (byte(position) === 255) position++
      const marker = byte(position++)
      if (marker === 0 || marker === 216 || marker === 217) throw Error('JPEG 文件段无效。')
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      const length = u16(position)
      if (length < 2 || position + length > bytes - 2) throw Error('JPEG 文件不完整。')
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8) throw Error('JPEG 尺寸头无效。')
        height = u16(position + 3); width = u16(position + 5)
      }
      if (marker === 218) { scan = true; break }
      position += length
    }
    if (!scan || !width || !height) throw Error('JPEG 文件缺少尺寸或图像数据。')
  } else {
    if (bytes < 20 || !tag(0, 'RIFF') || !tag(8, 'WEBP') || le32(4) + 8 !== bytes) throw Error('WebP 文件签名或长度无效。')
    let position = 12, pixels = false
    while (position + 8 <= bytes) {
      const length = le32(position + 4), start = position + 8, end = start + length
      if (end > bytes) throw Error('WebP 文件不完整。')
      if (tag(position, 'VP8X')) { if (length !== 10) throw Error('WebP 尺寸头无效。'); width = le24(start + 4) + 1; height = le24(start + 7) + 1 }
      else if (tag(position, 'VP8L')) {
        if (length < 5 || byte(start) !== 47) throw Error('WebP 无损尺寸头无效。')
        if (!width) { const bits = le32(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1 }
        pixels = true
      } else if (tag(position, 'VP8 ')) {
        if (length < 10 || ![157,1,42].every((v, n) => byte(start + 3 + n) === v)) throw Error('WebP 尺寸头无效。')
        if (!width) { width = (byte(start + 6) + byte(start + 7) * 256) & 0x3fff; height = (byte(start + 8) + byte(start + 9) * 256) & 0x3fff }
        pixels = true
      } else if (tag(position, 'ANMF') && length >= 16) pixels = true
      position = end + (length % 2)
    }
    if (position !== bytes || !pixels || !width || !height) throw Error('WebP 文件缺少尺寸或图像数据。')
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 40000000) throw Error('图片尺寸必须有效，边长不超过 16384 像素，总像素不超过 4000 万。')
  return { mime: 'image/' + header[1], width, height, bytes }
}

export function imageDiagnostics(image) {
  const errors = []
  if (!image || typeof image !== 'object' || Array.isArray(image)) return [{ code: 'image-shape', message: '图片图元需要内嵌数据、自然语言说明与原始尺寸。' }]
  if (typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 2000) errors.push({ code: 'image-alt', message: '图片说明需要非空自然语言，长度不超过 2000 字。' })
  let parsed
  try { parsed = parseImageSource(image.src) } catch (error) { errors.push({ code: 'image-source', message: error.message }) }
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || (parsed && (image.width !== parsed.width || image.height !== parsed.height))) errors.push({ code: 'image-dimensions', message: '图片原始尺寸必须与内嵌文件一致。' })
  return errors
}
