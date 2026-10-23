// Shared by the browser and the server. Embedded raster data is inert and
// self-contained; paths, remote URLs and SVG are deliberately unsupported.
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_BOARD_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_BOARD_REQUEST_BYTES = 12 * 1024 * 1024
const IMAGE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function imageCaptionHeight(element) {
  if(element.formulaGraphic)return 0
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

// A formula graphic keeps its original expression as provenance. After pixel
// edits the visible image is the current intent; the original is not a current
// mathematical assertion until the changed image has been reviewed.
export function formulaGraphicDiagnostics(element) {
  const graphic=element.formulaGraphic,errors=[],fail=(code,message)=>errors.push({code:'formula-'+code,message})
  if(graphic===undefined)return errors
  if(element.type!=='image')fail('type','数学图形只能属于独立图片图元。')
  if(!graphic||typeof graphic!=='object'||Array.isArray(graphic)){fail('shape','数学图形需要原始公式、原图、当前表达与编辑记录。');return errors}
  if(graphic.version!==1)fail('version','数学图形版本必须为 1。')
  if(typeof graphic.originalMath!=='string'||!graphic.originalMath.trim()||graphic.originalMath.length>10000)fail('source','原始数学表达需要非空文字，长度不超过 10000 字符。')
  if((element.math??'')!==''||(Array.isArray(element.mathExpressions)&&element.mathExpressions.length))fail('human-source','数学图形的公式源码只保存在机读映射中，不能同时放回画板的文字公式。')
  const original=graphic.originalImage
  if(!original||typeof original!=='object'||Array.isArray(original))fail('original-image','数学图形需要完整原始 PNG 和真实像素尺寸。')
  for(const [label,image] of [['当前',element.image],['原始',original]]){
    let parsed
    try{parsed=parseImageSource(image?.src);if(parsed.mime!=='image/png')fail('image-format',label+'数学图形必须使用内嵌 PNG。')}
    catch(error){fail('image-source',label+'数学图形：'+error.message)}
    if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||image.width<=0||image.height<=0||(parsed&&(image.width!==parsed.width||image.height!==parsed.height)))fail('image-dimensions',label+'数学图形的像素尺寸必须与 PNG 文件一致。')
  }
  if(!graphic.renderer||graphic.renderer.name!=='MathJax SVG'||graphic.renderer.version!=='3.2.2')fail('renderer','数学图形必须记录使用的 MathJax SVG 3.2.2 排版来源。')
  if(!['source-aligned','needs-review','reviewed'].includes(graphic.semanticStatus))fail('status','数学图形的语义状态必须是原公式一致、待校对或已校对。')
  if(graphic.semanticStatus==='needs-review'){
    if(graphic.currentMath!==null)fail('current','擦除或补画后的数学图形尚未校对，当前数学表达必须为空。')
  }else if(typeof graphic.currentMath!=='string'||!graphic.currentMath.trim()||graphic.currentMath.length>10000)fail('current','一致或已校对的数学图形需要非空当前数学表达，长度不超过 10000 字符。')
  if(!Array.isArray(graphic.edits)||graphic.edits.length>10000)fail('edits','数学图形编辑记录必须是列表，最多 10000 次编辑。')
  if(graphic.semanticStatus==='source-aligned'&&(graphic.currentMath!==graphic.originalMath||element.image?.src!==original?.src||element.erasures?.length||(Array.isArray(graphic.edits)&&graphic.edits.length)))fail('alignment','原公式一致状态需要当前原图、原表达和空编辑记录；改过的图形请标为待校对。')
  if(graphic.semanticStatus==='reviewed'&&(!graphic.review||typeof graphic.review!=='object'||Array.isArray(graphic.review)||typeof graphic.review.visualHash!=='string'||!/^[a-f0-9]{64}$/i.test(graphic.review.visualHash)))fail('review','已校对数学图形需要当前 PNG 数据的 SHA-256 校对指纹。')
  let pointCount=0
  const validPoints=points=>Array.isArray(points)&&points.length>0&&points.length<=20000&&points.every(point=>Array.isArray(point)&&point.length===2&&point.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e7))
  for(const edit of Array.isArray(graphic.edits)?graphic.edits:[]){
    if(!edit||typeof edit!=='object'||Array.isArray(edit)||!['erase','ink','crop'].includes(edit.kind)){fail('edit','编辑记录需要擦除、补画或裁剪类型。');continue}
    for(const key of ['x','y','width','height','radius','strokeWidth','rotation'])if(edit[key]!==undefined&&(!Number.isFinite(edit[key])||Math.abs(edit[key])>1e7||(['width','height','radius','strokeWidth'].includes(key)&&edit[key]<=0)))fail('geometry','数学图形编辑的几何数据必须有效。')
    for(const key of ['points','path'])if(edit[key]!==undefined){if(!validPoints(edit[key]))fail('geometry','数学图形编辑的路径需要有效像素坐标。');else pointCount+=edit[key].length}
    if(edit.strokes!==undefined){if(!Array.isArray(edit.strokes)||edit.strokes.length>200||!edit.strokes.every(validPoints))fail('geometry','数学图形补画笔迹需要有效像素坐标。');else pointCount+=edit.strokes.reduce((count,stroke)=>count+stroke.length,0)}
  }
  if(pointCount>100000)fail('geometry','数学图形编辑记录的坐标点合计不能超过 100000 个。')
  return errors
}
