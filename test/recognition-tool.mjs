import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject } from '../lib/index.js'
import { createRecognitionRequest } from '../lib/recognition.js'
import { mcpToolResult } from '../scripts/mcp-image-content.mjs'
const png='iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const bytes=Buffer.from(png,'base64')
const attachment=()=>({attachmentId:'opaque-host-owned-image-id',mediaType:'image/png',bytes:bytes.length,width:3,height:2,name:'圈选.png'})
async function fixture(t,host={}){
  const root=mkdtempSync(join(tmpdir(),'anatomy-recognition-tool-')),tools=new Map(),ctx={tools:{register(d){tools.set(d.name,d)}},...host}
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  apply(ctx,{rootDir:root,autoServe:false,autoOpen:false})
  const init=await tools.get('anatomy_init').execute({body:'demo',title:'测试画板',oneline:'核对说明。'});assert.equal(init.ok,true)
  const dir=join(root,'anatomy-demo'),body=readFileSync(join(dir,'body.json'),'utf8'),created=createRecognitionRequest(dir,{mode:'math',image:'data:image/png;base64,'+png})
  return {root,dir,body,ctx,created,tool:tools.get('anatomy_recognition')}
}
function noRawBytes(content){assert.ok(content.filter(c=>c.type==='text').every(c=>!c.text.includes(png)))}
function unchanged(f){assert.equal(readFileSync(join(f.dir,'body.json'),'utf8'),f.body)}

test('缺少DSH附件服务时只给验证过的只读imagePath，MCP仍返回标准PNG而候选不改工程',async t=>{
  const f=await fixture(t),{dir,created,tool}=f
  assert.deepEqual(inject,['tools','skills'])
  const pending=await tool.execute({dir,action:'pending'});assert.equal(pending.requests[0].id,created.request.id)
  const value=await tool.execute({dir,action:'read',id:created.request.id})
  assert.equal(value.ok,true);assert.equal(value.imageDisplay,'file-only');assert.match(value.hint,/read_image/)
  assert.equal(value.imagePath,join(dir,'.anatomy-runtime','recognition','requests',created.request.id,'input.png'));assert.deepEqual(readFileSync(value.imagePath),bytes)
  const dsh=tool.output.render({},value),mcp=mcpToolResult('anatomy_recognition',value)
  assert.equal(dsh.filter(c=>c.type==='image').length,0);assert.equal(mcp.content.filter(c=>c.type==='image').length,1);assert.equal(mcp.content.find(c=>c.type==='image').data,png)
  noRawBytes(dsh);noRawBytes(mcp.content)
  const bad=await tool.execute({dir,action:'complete',id:value.request.id,imageHash:'wrong',text:'x=1'});assert.equal(bad.ok,false)
  const completed=await tool.execute({dir,action:'complete',id:value.request.id,imageHash:value.request.imageHash,text:'x=1+2',engine:'dsh'})
  assert.equal(completed.request.result.text,'x=1+2');unchanged(f)
  const twice=await tool.execute({dir,action:'complete',id:value.request.id,imageHash:value.request.imageHash,text:'late'});assert.equal(twice.ok,false)
  const corrupt=structuredClone(value);corrupt.image.sha256='wrong';assert.equal(mcpToolResult('anatomy_recognition',corrupt).content.filter(c=>c.type==='image').length,0)
})

test('DSH read等待官方saveImage保存后返回durable attachment，output.render不再访问宿主或存储',async t=>{
  let saved,release,started,reads=0,service
  const began=new Promise(resolve=>{started=resolve}),ref=attachment()
  service={async saveImage(input){assert.equal(this,service);saved=input;started();return new Promise(resolve=>{release=()=>resolve(ref)})}}
  const f=await fixture(t,{get(name){reads++;assert.equal(name,'attachments');return service}}),{dir,created,tool}=f
  let finished=false;const reading=tool.execute({dir,action:'read',id:created.request.id}).then(value=>{finished=true;return value})
  await began;assert.equal(finished,false);assert.ok(saved.data instanceof Uint8Array);assert.deepEqual(Buffer.from(saved.data),bytes);assert.equal(saved.mediaType,'image/png');assert.equal(saved.name,'anatomy-recognition-'+created.request.id+'.png')
  release();const value=await reading;assert.equal(value.ok,true);assert.equal(value.imageDisplay,'attachment');assert.deepEqual(value.imageAttachment,ref)
  const dsh=tool.output.render({},value);assert.deepEqual(dsh.filter(c=>c.type==='image'),[{type:'image',attachment:ref}]);assert.equal(reads,1)
  tool.output.render({},value);assert.equal(reads,1);assert.equal(Object.hasOwn(dsh.find(c=>c.type==='image'),'data'),false);assert.equal(Object.hasOwn(dsh.find(c=>c.type==='image'),'mimeType'),false);noRawBytes(dsh)
  const mcp=mcpToolResult('anatomy_recognition',value);assert.deepEqual(mcp.content.filter(c=>c.type==='image'),[{type:'image',data:png,mimeType:'image/png'}]);noRawBytes(mcp.content)
  const corrupt=structuredClone(value);corrupt.image.sha256='wrong';assert.equal(tool.output.render({},corrupt).filter(c=>c.type==='image').length,0)
  const completed=await tool.execute({dir,action:'complete',id:value.request.id,imageHash:value.request.imageHash,text:'x=2',engine:'dsh'});assert.equal(completed.request.result.text,'x=2');unchanged(f)
})

test('可选DSH附件在使用时动态探测，未安装不阻塞启动，后来可用即可接入',async t=>{
  let service,calls=0
  const f=await fixture(t,{get(name){assert.equal(name,'attachments');return service}}),{dir,created,tool}=f
  const absent=await tool.execute({dir,action:'read',id:created.request.id});assert.equal(absent.imageDisplay,'file-only')
  service={async saveImage(){calls++;return attachment()}}
  const ready=await tool.execute({dir,action:'read',id:created.request.id});assert.equal(ready.imageDisplay,'attachment');assert.equal(calls,1)
  service=undefined;const gone=await tool.execute({dir,action:'read',id:created.request.id});assert.equal(gone.imageDisplay,'file-only');assert.equal(tool.output.render({},gone).filter(c=>c.type==='image').length,0);unchanged(f)
})

test('不假造ingestImage接口，附件保存失败或ref格式错误保留read_image与MCP取图后备',async t=>{
  for(const service of [{async ingestImage(){throw Error('未经官方API确认的方法不可调用')}},{async saveImage(){throw Error('host storage unavailable')}},{async saveImage(){return {type:'image',data:png,mimeType:'image/png'}}}]){
    const f=await fixture(t,{attachments:service}),{dir,created,tool}=f
    const value=await tool.execute({dir,action:'read',id:created.request.id});assert.equal(value.ok,true);assert.equal(value.imageDisplay,'file-only');assert.match(value.hint,/read_image/);assert.deepEqual(readFileSync(value.imagePath),bytes)
    assert.equal(tool.output.render({},value).filter(c=>c.type==='image').length,0);assert.equal(mcpToolResult('anatomy_recognition',value).content.filter(c=>c.type==='image').length,1);unchanged(f)
  }
})

test('DSH附件存储等待期间请求取消，晚到attachment不能成为有效识别来源',async t=>{
  let release,started;const began=new Promise(resolve=>{started=resolve})
  const f=await fixture(t,{attachments:{async saveImage(){started();return new Promise(resolve=>{release=()=>resolve(attachment())})}}}),{dir,created,tool}=f
  const reading=tool.execute({dir,action:'read',id:created.request.id});await began
  const cancelled=await tool.execute({dir,action:'cancel',id:created.request.id});assert.equal(cancelled.request.status,'cancelled')
  release();const value=await reading;assert.equal(value.ok,false);assert.match(value.error.message,/取消|过期/);assert.equal(tool.output.render({},value).filter(c=>c.type==='image').length,0);assert.equal(mcpToolResult('anatomy_recognition',value).content.filter(c=>c.type==='image').length,0);unchanged(f)
})


test('可选附件ctx.get异常也保持验证过的read_image后备，不阻塞当前图片读取',async t=>{
  const f=await fixture(t,{get(){throw Error('optional service resolver unavailable')}}),{dir,created,tool}=f
  const value=await tool.execute({dir,action:'read',id:created.request.id});assert.equal(value.ok,true);assert.equal(value.imageDisplay,'file-only');assert.match(value.hint,/optional service resolver unavailable.*read_image/);assert.deepEqual(readFileSync(value.imagePath),bytes)
  assert.equal(tool.output.render({},value).filter(c=>c.type==='image').length,0);assert.equal(mcpToolResult('anatomy_recognition',value).content.filter(c=>c.type==='image').length,1);unchanged(f)
})
