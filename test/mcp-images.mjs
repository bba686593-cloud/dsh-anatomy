import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { saveVersion, versionState, readVersion } from '../lib/versions.js'
import { mcpToolResult } from '../scripts/mcp-image-content.mjs'

const png='iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const webp='UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoDAAIAAUAmJaACdLoAA5gA/u7T3/43jwK8l2V/7oMs4ZzAAAA='
const picture=(id='picture',format='png',data=png)=>({id,type:'image',x:0,y:0,width:300,height:260,
  image:{src:'data:image/'+format+';base64,'+data,alt:'输入处理的工程图片',width:3,height:2,extension:{preserve:true}},
  text:'核对输入范围。',implementation:{code:'return input;'},extension:{preserve:true}})
const imageBlocks=result=>result.content.filter(block=>block.type==='image')
test('数学图形只发送当前PNG视觉，原始图片以指纹摘要保留完整机读来源',()=>{
  const element=picture();element.formulaGraphic={originalImage:{src:'data:image/webp;base64,'+webp,width:3,height:2},originalMath:'y=ax',currentMath:null,semanticStatus:'needs-review'}
  const value={ok:true,board:{version:1,elements:[element]}},wrapped=mcpToolResult('anatomy_board',value)
  assert.equal(imageBlocks(wrapped).length,1);assert.equal(imageBlocks(wrapped)[0].data,png)
  assert.ok(!wrapped.content.filter(c=>c.type==='text').some(c=>c.text.includes(webp)||c.text.includes(png)))
  assert.equal(wrapped.structuredContent.board.elements[0].formulaGraphic.originalImage.src,element.formulaGraphic.originalImage.src)
  assert.equal(wrapped.structuredContent.board.elements[0].formulaGraphic.currentMath,null)
})
test('前一图元的原始PNG同时是后一图元的当前图，两个当前视觉都不能遗漏',()=>{
  const a=picture('changed','webp',webp),b=picture('original');a.formulaGraphic={originalImage:{src:b.image.src,width:3,height:2}}
  const result=mcpToolResult('anatomy_board',{ok:true,board:{elements:[a,b]}})
  assert.equal(imageBlocks(result).length,2);assert.ok(imageBlocks(result).some(c=>c.data===png));assert.ok(imageBlocks(result).some(c=>c.data===webp))
})
function paddedPng(seed=65){
  const original=Buffer.from(png,'base64'),payload=Buffer.alloc(3*1024*1024,seed),chunk=Buffer.alloc(payload.length+12)
  chunk.writeUInt32BE(payload.length);chunk.write('tEXt',4);payload.copy(chunk,8)
  let crc=0xffffffff
  for(const value of chunk.subarray(4,chunk.length-4)){crc^=value;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4)
  return Buffer.concat([original.subarray(0,-12),chunk,original.subarray(-12)]).toString('base64')
}

test('MCP图片包装去除src长文本且保留原JSON，标准内容块关联图元并按资源去重',()=>{
  const a=picture(),b=picture('duplicate'),value={ok:true,version:{board:{version:1,elements:[a,b]}},selected:{id:'chosen'},selectionRevision:'revision'}
  const before=JSON.stringify(value),wrapped=mcpToolResult('anatomy_selected_version',value)
  assert.equal(wrapped.structuredContent,value)
  assert.equal(JSON.stringify(value),before)
  assert.equal(imageBlocks(wrapped).length,1)
  assert.deepEqual(imageBlocks(wrapped)[0],{type:'image',data:png,mimeType:'image/png'})
  const text=JSON.parse(wrapped.content[0].text)
  assert.match(text.version.board.elements[0].image.src,/sha256:[a-f0-9]{64}/)
  assert.equal(text.selectionRevision,'revision')
  assert.ok(!wrapped.content.filter(block=>block.type==='text').some(block=>block.text.includes(png)))
  const context=JSON.parse(wrapped.content.find(block=>block.type==='text'&&block.text.includes('boardImage')).text)
  assert.deepEqual(context.boardImage.nodes.map(node=>node.element),['picture','duplicate'])
  assert.equal(wrapped.structuredContent.version.board.elements[0].image.src,a.image.src)
})

test('无效来源和当前板超过图片预算都不附视觉，不扫描历史或其他工具数据',()=>{
  const invalid=picture();invalid.image.src='data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')
  const bad=mcpToolResult('anatomy_board',{ok:true,board:{version:1,elements:[invalid]}})
  assert.equal(imageBlocks(bad).length,0)
  assert.ok(!bad.content[0].text.includes(invalid.image.src))
  assert.equal(bad.structuredContent.board.elements[0].image.src,invalid.image.src)
  const large=paddedPng(),tooMany=Array.from({length:3},(_,index)=>picture('image-'+index,'png',paddedPng(65+index)))
  const excess=mcpToolResult('anatomy_board',{ok:true,board:{version:1,elements:tooMany}})
  assert.equal(imageBlocks(excess).length,0)
  assert.ok(excess.content.some(block=>block.type==='text'&&block.text.includes('超过 8 MiB')))
  const other=mcpToolResult('anatomy_history',{ok:true,board:{version:1,elements:[picture()]}})
  assert.equal(imageBlocks(other).length,0)
  assert.equal(JSON.parse(other.content[0].text).board.elements[0].image.src,picture().image.src)
})

test('图片节点独立校验，坏说明的同资源节点不阻止另一合法图元预览',()=>{
  const a=picture('bad'),b=picture('valid');a.image.alt='const x = 1;'
  const result=mcpToolResult('anatomy_board',{ok:true,board:{version:1,elements:[a,b]}})
  assert.equal(imageBlocks(result).length,1)
  const context=result.content.find(block=>block.type==='text'&&block.text.includes('boardImage'))
  assert.deepEqual(JSON.parse(context.text).boardImage.nodes.map(node=>node.element),['valid'])
  assert.ok(result.content.some(block=>block.type==='text'&&block.text.includes('未通过校验')))
})

test('真实stdio工具读取选定图为ImageContent，完整结构可严格应用和回写，旧历史不发送', {timeout:30000},async t=>{
  const root=mkdtempSync('/tmp/anatomy-mcp-images-'),dir=join(root,'anatomy-project')
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const defs=new Map();apply({tools:{register:d=>defs.set(d.name,d)}},{rootDir:root,autoServe:false})
  const direct=(name,args={})=>defs.get('anatomy_'+name).execute({dir,repoRoot:root,...args})
  assert.equal((await direct('init',{body:'project',title:'图片工程',oneline:'通过图片理解输入处理。'})).ok,true)
  const oldBoard={version:1,elements:[picture('older','webp',webp)]}
  assert.equal((await direct('board',{board:oldBoard})).ok,true)
  const state=versionState(dir),first=saveVersion(dir,{body:'project',board:state.board,baseHash:state.hash,expectedSelection:null,label:'旧图片'})
  const selectedBoard={version:1,elements:[picture(),picture('duplicate')]};selectedBoard.elements[1].x=400
  const second=saveVersion(dir,{body:'project',board:selectedBoard,baseHash:state.hash,expectedSelection:first.selected.revision,label:'当前图片'})
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/mcp-server.mjs',import.meta.url)),'--root',root],{stdio:['pipe','pipe','pipe']})
  t.after(()=>child.kill())
  const waiting=new Map();let id=0
  createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line),pending=waiting.get(message.id);if(pending){waiting.delete(message.id);pending.resolve(message)}})
  child.on('exit',()=>{for(const pending of waiting.values())pending.reject(Error('MCP exited'));waiting.clear()})
  child.on('error',error=>{for(const pending of waiting.values())pending.reject(error);waiting.clear()})
  const call=(method,params)=>new Promise((resolve,reject)=>{waiting.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
  const invoke=async(name,args={})=>(await call('tools/call',{name:'anatomy_'+name,arguments:{dir,repoRoot:root,...args}})).result
  assert.equal((await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'anatomy')
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n')
  const read=await invoke('selected_version')
  assert.equal(imageBlocks(read).length,1);assert.equal(imageBlocks(read)[0].data,png)
  assert.equal(read.structuredContent.selected.id,second.saved)
  assert.equal(read.structuredContent.version.board.elements[0].image.src,picture().image.src)
  assert.ok(!read.content.some(block=>block.type==='image'&&block.data===webp))
  assert.ok(!read.content.some(block=>block.type==='text'&&block.text.includes(png)))
  const applied=await invoke('selected_version',{apply:true,selectionRevision:read.structuredContent.selectionRevision})
  assert.equal(applied.structuredContent.ok,true)
  assert.deepEqual(versionState(dir).board,selectedBoard)
  const current=await invoke('board',{element:'picture'})
  assert.equal(imageBlocks(current).length,1)
  assert.equal(current.structuredContent.program.image.src,picture().image.src)
  assert.match(JSON.parse(current.content[0].text).program.image.src,/sha256:/)
  const digest=await invoke('digest')
  assert.equal(imageBlocks(digest).length,1)
  assert.ok(digest.structuredContent.text.includes(picture().image.src))
  assert.ok(!digest.content.filter(block=>block.type==='text').some(block=>block.text.includes(png)))
  const written=await invoke('board',{board:current.structuredContent.board})
  assert.equal(written.structuredContent.ok,true)
  assert.equal(versionState(dir).board.elements[0].image.src,picture().image.src)
  assert.equal(readVersion(dir,first.saved).board.elements[0].image.src,oldBoard.elements[0].image.src)
  assert.ok(readFileSync(join(dir,'body.json'),'utf8').includes(png))
})

test('局部擦除后的MCP视觉发送实际PNG，不按相同原图合并不同遮罩',async()=>{
  const {decodePng,maskedImageSource}=await import('../lib/png-surface.js');const {createHash}=await import('node:crypto');
  const one=picture('masked-one'),two=picture('masked-two'),original=picture('unmasked');
  for(const e of [one,two,original])e.formulaGraphic={originalImage:{src:e.image.src,width:3,height:2}};
  one.erasures=[{surface:'body',points:[[1/6,.25]],radius:[.1,.1]}];two.erasures=[{surface:'body',points:[[5/6,.75]],radius:[.1,.1]}];
  const value={ok:true,version:{board:{version:1,elements:[one,two,original]}}},before=JSON.stringify(value),wrapped=mcpToolResult('anatomy_selected_version',value),images=imageBlocks(wrapped),contexts=wrapped.content.filter(b=>b.type==='text'&&b.text.includes('boardImage')).map(b=>JSON.parse(b.text).boardImage);
  assert.equal(images.length,3);assert.equal(JSON.stringify(value),before);assert.equal(wrapped.structuredContent,value);
  for(const [index,e]of [one,two,original].entries()){
    const expected=maskedImageSource(e).split(',')[1];assert.equal(images[index].data,expected);assert.equal(contexts[index].sha256,createHash('sha256').update(Buffer.from(expected,'base64')).digest('hex'));assert.equal(contexts[index].nodes[0].element,e.id);
  }
  assert.notEqual(images[0].data,png);assert.notEqual(images[1].data,png);assert.notEqual(images[0].data,images[1].data);assert.equal(images[2].data,png);
  const first=decodePng(Buffer.from(images[0].data,'base64')),second=decodePng(Buffer.from(images[1].data,'base64'));const alpha=(image,u,v)=>image.data[(Math.floor(v*image.height)*image.width+Math.floor(u*image.width))*4+3];assert.equal(alpha(first,1/6,.25),0);assert.equal(alpha(first,5/6,.75),255);assert.equal(alpha(second,1/6,.25),255);assert.equal(alpha(second,5/6,.75),0);assert.equal(contexts[0].width,first.width);assert.equal(contexts[0].height,first.height);assert.ok(first.width>3&&first.height>2);
  assert.ok(contexts[0].nodes[0].erased);assert.ok(!wrapped.content.filter(b=>b.type==='text').some(b=>b.text.includes(png)));
  const digest=mcpToolResult('anatomy_digest',{ok:true,text:'## 自由画板与程序映射\n- 图元 masked-one：'+JSON.stringify(one)+'\n## 其他'});assert.equal(imageBlocks(digest)[0].data,images[0].data);
});

test('有擦痕的WebP和无法解码的PNG不发送原始视觉，数据仍完整保留',()=>{
  for(const element of [picture('masked-webp','webp',webp),picture('masked-invalid','png',png)]){
    element.erasures=[{surface:'body',points:[[.5,.5]],radius:[.2,.2]}];
    if(element.id==='masked-invalid'){const bytes=Buffer.from(png,'base64');bytes[28]=1;element.image.src='data:image/png;base64,'+bytes.toString('base64')}
    const value={ok:true,board:{elements:[element]}},before=JSON.stringify(value),wrapped=mcpToolResult('anatomy_board',value);assert.equal(imageBlocks(wrapped).length,0);assert.equal(JSON.stringify(value),before);assert.ok(wrapped.content.some(b=>b.type==='text'&&b.text.includes('未附加原图')));
  }
});
