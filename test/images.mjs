import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { apply } from '../lib/index.js'
import { boardDiagnostics, boardBundle, elementProgram, lineEnds } from '../lib/board.js'
import { parseImageSource, imageCaptionHeight, MAX_IMAGE_BYTES, MAX_BOARD_IMAGE_BYTES, MAX_BOARD_REQUEST_BYTES } from '../lib/images.js'
import { autoLayout, boxesOverlap, layoutBox } from '../lib/layout.js'
import { humanMap, agentDigest } from '../lib/digest.js'
import { mappingIndex, impactOf } from '../lib/mapping.js'
import { readingRoutes, partTitle } from '../lib/reading.js'
import { saveVersion, selectVersion, selectedVersion, versionState, listVersions, readVersion } from '../lib/versions.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDBooor3zzT/9k='
const webp = 'UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoDAAIAAUAmJaACdLoAA5gA/u7T3/43jwK8l2V/7oMs4ZzAAAA='
const source = (format='png', data=png) => 'data:image/'+format+';base64,'+data
const imageElement = (id='picture') => ({ id, type:'image', x:0, y:0, width:300, height:260,
  image:{src:source(),alt:'输入与结果的工程示意图',width:3,height:2,extension:{keep:true}},
  text:'图示说明输入处理的边界。', implementation:{language:'JavaScript',code:'return input;',extension:{keep:true}},
  anchors:[], extension:{keep:true} })
const board = () => ({version:1,elements:[imageElement()]})

// Add a valid ancillary PNG chunk to exercise byte limits without requiring
// native image codecs in the plugin's test environment.
function largePng(bytes) {
  const original=Buffer.from(png,'base64'),payload=Buffer.alloc(bytes-original.length-12,65),chunk=Buffer.alloc(payload.length+12)
  chunk.writeUInt32BE(payload.length);chunk.write('tEXt',4);payload.copy(chunk,8)
  let crc=0xffffffff
  for(const value of chunk.subarray(4,chunk.length-4)){crc^=value;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4)
  return source('png',Buffer.concat([original.subarray(0,-12),chunk,original.subarray(-12)]).toString('base64'))
}

test('PNG、JPEG、WebP 真实文件头解析原始尺寸，不依赖浏览器或本机解码库',()=>{
  for(const [format,data] of [['png',png],['jpeg',jpeg],['webp',webp]]){
    const parsed=parseImageSource(source(format,data))
    assert.deepEqual(parsed,{mime:'image/'+format,width:3,height:2,bytes:Buffer.from(data,'base64').length})
  }
  assert.deepEqual(boardDiagnostics(board()),[])
})

test('远程、SVG、脚本、非规范base64、伪造格式和损坏结尾全部拒绝',()=>{
  const invalid=['https://outside.example/image.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zy8+',source('jpeg',png),source('png','AAAA'),source('png',png+'\n'),source('png',png.slice(0,-4)),source('png','AR==')]
  for(const src of invalid){assert.throws(()=>parseImageSource(src));const b=board();b.elements[0].image.src=src;assert.ok(boardDiagnostics(b).some(e=>e.code==='board/image-source'),src)}
})

test('图片尺寸、自然说明和类型有严格校验，代码不能进入图注',()=>{
  for(const mutate of [e=>delete e.image,e=>e.image.alt='',e=>e.image.width=999,e=>e.image.height=0,e=>e.image.width=3.5,e=>e.type='rect']){
    const b=board();mutate(b.elements[0]);assert.ok(boardDiagnostics(b).some(e=>e.code.startsWith('board/image-')))
  }
  const b=board();b.elements[0].image.alt='const secret = 1;';assert.ok(boardDiagnostics(b).some(e=>e.code==='human/program-language'))
  const oversized=Buffer.from(png,'base64');oversized.writeUInt32BE(20000,16)
  assert.throws(()=>parseImageSource(source('png',oversized.toString('base64'))),/尺寸/)
})

test('单图6MiB、全板8MiB同时限制，完整候选板中的重复图片也计入',()=>{
  assert.throws(()=>parseImageSource(largePng(MAX_IMAGE_BYTES+1)),/6 MiB/)
  const src=largePng(MAX_BOARD_IMAGE_BYTES/2+1),b=board();b.elements[0].image.src=src
  assert.deepEqual(boardDiagnostics(b),[])
  const duplicate=structuredClone(b.elements[0]);duplicate.id='duplicate';b.elements.push(duplicate)
  assert.ok(boardDiagnostics(b).some(e=>e.code==='board/image-limit'))
})

test('布局图像保留比例图幅并为自然图注和公式留空间，碰撞避让幂等',()=>{
  const b=board(),e=b.elements[0];e.height=80;e.text='输入说明。\n边界说明。\n结果说明。';e.math='y = f(x)';e.mathExpressions=[{id:'constraint',value:'x ≥ 0'}]
  b.elements.push({id:'neighbor',type:'rect',x:0,y:20,width:300,height:100,text:'相邻处理'})
  const next=autoLayout(b),picture=next.elements[0]
  assert.equal(picture.width,300)
  assert.ok(picture.height>=200+imageCaptionHeight(picture))
  assert.equal(boxesOverlap(layoutBox(picture),layoutBox(next.elements[1])),false)
  assert.deepEqual(picture.image,e.image)
  assert.deepEqual(autoLayout(next),next)
})

test('人读仅使用图片说明与图注，机读含完整嵌入图和源码映射',()=>{
  const b=board();b.elements[0].text='';b.elements[0].anchors=[{file:'src/input.js',symbol:'receive',sha256:'a'.repeat(64)}]
  const human=humanMap({title:'工程',board:b},[],[]),machine=agentDigest({board:b},[],[])
  assert.ok(human.includes(b.elements[0].image.alt));assert.ok(!human.includes('data:image/'));assert.ok(!human.includes('return input;'))
  assert.ok(machine.includes(b.elements[0].image.src));assert.ok(machine.includes('src/input.js'))
  assert.equal(elementProgram(b.elements[0]).image.src,b.elements[0].image.src)
  assert.equal(mappingIndex({board:b},[],[]).files[0].refs[0].name,b.elements[0].image.alt)
  assert.equal(impactOf({board:b},[],[],{files:['src/input.js']}).elements[0].id,'picture')
  assert.equal(partTitle(b.elements[0]),b.elements[0].image.alt)
  assert.equal(readingRoutes(b,{},[],[])[0].steps[0].description,b.elements[0].image.alt)
  const attached={id:'edge',type:'arrow',x:400,y:130,width:1,height:1,from:'picture'}
  assert.equal(lineEnds(attached,[...b.elements,attached]).a.x,300)
})

test('图片版本保存、选择和严格应用保持原图、标识、指纹与未知元数据',async t=>{
  const root=mkdtempSync('/tmp/anatomy-images-');t.after(()=>rmSync(root,{recursive:true,force:true}))
  const defs=new Map();apply({tools:{register:d=>defs.set(d.name,d)}},{rootDir:root,autoServe:false})
  const dir=join(root,'anatomy-project'),call=(name,args={})=>defs.get('anatomy_'+name).execute({dir,repoRoot:root,...args})
  writeFileSync(join(root,'source.js'),'export const input = 1;')
  assert.equal((await call('init',{body:'project',title:'图片工程',oneline:'说明图片对应的输入处理。'})).ok,true)
  const initial=board();initial.elements[0].anchors=[{file:'source.js',role:'implementation',reason:'输入处理'}]
  assert.equal((await call('board',{board:initial})).ok,true)
  const state=versionState(dir),first=saveVersion(dir,{body:'project',board:state.board,baseHash:state.hash,expectedSelection:null,label:'原图'})
  const changed=structuredClone(state.board);changed.elements[0].image.alt='调整后的工程图说明'
  const second=saveVersion(dir,{body:'project',board:changed,baseHash:state.hash,expectedSelection:first.selected.revision,label:'修改图注'})
  const read=await call('selected_version');assert.equal((await call('selected_version',{apply:true,selectionRevision:read.selectionRevision})).ok,true)
  assert.deepEqual(versionState(dir).board,changed);assert.equal(selectedVersion(dir).pending,false)
  const restored=selectVersion(dir,{id:first.saved,baseHash:versionState(dir).hash,expectedSelection:second.selected.revision})
  assert.equal((await call('selected_version',{apply:true,selectionRevision:restored.selected.revision})).ok,true)
  assert.deepEqual(versionState(dir).board,state.board);assert.deepEqual(readVersion(dir,second.saved).board,changed);assert.equal(listVersions(dir).versions.length,2)
  const disk=readFileSync(join(dir,'body.json'),'utf8'),bad=structuredClone(state.board);bad.elements[0].image.src='https://outside.example/a.png'
  assert.equal((await call('apply_edits',{...boardBundle(state.board,bad,'project',versionState(dir).hash),force:true,strict:false})).ok,false)
  assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk)
})

test('JSON桥接使用12MiB字节限制并返回结构化超限诊断',()=>{
  const result=spawnSync(process.execPath,['scripts/board-api.mjs','/tmp'],{input:JSON.stringify({action:'list',padding:'中'.repeat(Math.ceil(MAX_BOARD_REQUEST_BYTES/3))}),encoding:'utf8',maxBuffer:1024*1024})
  assert.equal(result.status,0);const output=JSON.parse(result.stdout)
  assert.equal(output.status,413);assert.equal(output.result.error.code,'version/request-limit')
})
