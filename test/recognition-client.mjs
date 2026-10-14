import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const plain=value=>JSON.parse(JSON.stringify(value))
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>plain(data)})
const deferred=()=>{let resolve;return{promise:new Promise(value=>{resolve=value}),resolve}}
const healthy={service:'anatomy-handwriting',ready:true,providers:{agent:{available:true,mode:'handoff'},local:{available:true,ready:true}}}
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve()}

function runtime(options={}){
  const nodes=new Map(),storage=new Map(),calls=[],clipboard=[],timers=new Map();let timerId=0,requestId=null,polls=0
  if(options.preference)storage.set('anatomy-recognition:preferences',JSON.stringify(options.preference))
  const node=id=>{
    if(nodes.has(id))return nodes.get(id)
    const element={id,value:'',innerHTML:'',textContent:'',innerText:'',style:{},dataset:{},attributes:{},listeners:{},hidden:id==='inline-writing',open:false,
      classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(key,value){this.attributes[key]=value},getAttribute(key){return this.attributes[key]},
      addEventListener(type,listener){(this.listeners[type]||=[]).push(listener)},closest(){return null},querySelector(){return null},querySelectorAll(){return[]},
      getBoundingClientRect(){return{left:0,top:0,width:1000,height:700}},showModal(){this.open=true},close(){this.open=false},setPointerCapture(){},focus(){},select(){},setSelectionRange(){},click(){},appendChild(){},remove(){},contains(){return false},
      getContext(){return{fillRect(){},scale(){},translate(){},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){},stroke(){}}},toDataURL(){return png}}
    nodes.set(id,element);return element
  }
  node('ink-result').parentElement={tagName:'LABEL',hidden:false}
  const fetch=async(url,init={})=>{
    calls.push({url,...init})
    const pathname=url.startsWith('http:')?new URL(url).pathname:url
    if(options.fetch){const custom=await options.fetch(url,init);if(custom)return custom}
    if(pathname==='/api/versions'||pathname==='/api/versions/current')return response({ok:true,versions:[],selected:options.selected||null})
    if(pathname==='/api/health'||pathname==='/api/recognition/health')return response(options.health||healthy)
    if(pathname==='/api/recognition/connect')return response({ok:true,token:'session-only-token',expiresAt:Date.now()+60000})
    if(pathname==='/api/recognition/local'||pathname==='/api/recognize')return response({ok:true,text:'本地候选',engine:'local-test',mode:'text'})
    if(pathname==='/api/recognition/agent'&&init.method==='POST'){
      requestId=JSON.parse(init.body).id
      return response({ok:true,request:{id:requestId,status:options.initialStatus||'pending',...(options.initialStatus==='completed'?{result:{text:'智能体候选',engine:'agent-test',mode:'text'}}:{})}})
    }
    if(pathname.endsWith('/cancel'))return response({ok:true,request:{id:requestId,status:'cancelled'}})
    if(pathname.startsWith('/api/recognition/agent/')){
      const status=options.pollStatuses?.[polls++]||'completed'
      return response({ok:true,request:{id:requestId,status,...(status==='completed'?{result:{text:'智能体候选',engine:'agent-test',mode:'text'}}:{})}})
    }
    return response({ok:false,error:'unexpected fixture URL'},404)
  }
  const context={document:{compatMode:'CSS1Compat',getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,body:node('body'),addEventListener(){},createElement:type=>node('created-'+type),getSelection:()=>null},
    window:{addEventListener(){}},navigator:{clipboard:{async writeText(value){clipboard.push(value)}}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},structuredClone,Blob,URL,AbortController,console,fetch,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)}}
  const board={version:1,layout:{mode:'manual'},elements:[{id:'stroke',type:'pen',x:0,y:0,width:100,height:1,points:[[0,.5],[1,.5]],text:'',math:'',stroke:'#18233b',strokeWidth:2}]}
  const html=renderAnatomy({slug:'recognition-test',title:'识别协议验证',board},[],[])
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context)
  context.captureLassoRaster=async()=>({src:png,bounds:{x:30,y:-30,width:40,height:60}})
  const api=context.window.__anatomyBoard
  return{api,node,storage,calls,clipboard,context,html,
    fire(id,type,event={}){return Promise.all((node(id).listeners[type]||[]).map(listener=>listener({preventDefault(){},...event})))},
    async open(mode='text'){api.graphics.lasso([{x:30,y:-30},{x:70,y:-30},{x:70,y:30},{x:30,y:30}]);await api.math.openHandwriting({mode});await settle()},
    async tick(delay){for(const[id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn()}await settle()}}
}

test('默认由当前智能体识别，待接管任务可复制提示且候选确认前不修改画板',async()=>{
  const r=runtime({pollStatuses:['processing','completed']});await r.open();const before=plain(r.api.board)
  assert.equal(r.api.math.provider,'agent');assert.equal(r.node('ink-provider').value,'agent');assert.equal(r.node('ink-local-settings').hidden,true)
  const pending=r.api.math.recognizeInk();await settle()
  const submitted=r.calls.find(call=>call.url==='/api/recognition/agent'&&call.method==='POST'),payload=JSON.parse(submitted.body)
  assert.match(payload.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(payload.mode,'text');assert.equal(payload.image,png);assert.equal(typeof payload.sourceRevision,'string');assert.deepEqual(payload.sourceElements,['stroke']);assert.equal(payload.selectionRevision,null)
  assert.equal(r.node('ink-agent-waiting').hidden,false);assert.equal(r.node('ink-agent-id').textContent,payload.id);assert.match(r.node('ink-agent-prompt').value,/anatomy_recognition/);assert.match(r.node('ink-feedback').textContent,/等待接管/)
  await r.fire('ink-agent-copy','click');assert.match(r.clipboard[0],new RegExp(payload.id));assert.deepEqual(plain(r.api.board),before)
  await r.tick(1000);assert.match(r.node('ink-agent-status').textContent,/正在识别/);assert.equal(r.node('ink-apply').disabled,true)
  await r.tick(1000);assert.equal(await pending,true);assert.equal(r.node('ink-result').value,'智能体候选');assert.equal(r.node('ink-apply').disabled,false);assert.deepEqual(plain(r.api.board),before)
  assert.equal(r.calls.some(call=>call.url==='/api/recognize'||call.url.endsWith('/api/recognition/local')),false)
})

test('旧服务没有智能体能力时要求更新重建，不能显示已连接或提交假任务',async()=>{
  const r=runtime({health:{service:'anatomy-handwriting',ready:true}});await r.open()
  assert.match(r.node('ink-service').textContent,/不支持智能体识别.*重新构建/)
  assert.equal(await r.api.math.recognizeInk(),false)
  assert.equal(r.calls.some(call=>call.url==='/api/recognition/agent'),false)
})

test('配置独立executor后说明模型服务处理图片，等待时不要求复制接管提示',async()=>{
  const r=runtime({health:{...healthy,providers:{...healthy.providers,agent:{available:true,mode:'executor'}}}});await r.open()
  assert.match(r.node('ink-provider-hint').textContent,/独立智能体任务/);assert.match(r.node('ink-provider-hint').textContent,/模型服务处理/)
  const pending=r.api.math.recognizeInk();await settle()
  assert.equal(r.node('ink-agent-handoff').hidden,true);assert.match(r.node('ink-agent-status').textContent,/任务已提交/);assert.doesNotMatch(r.node('ink-feedback').textContent,/复制|接管/)
  await r.tick(1000);assert.equal(await pending,true)
})

test('新本地服务手动握手，token仅保存在内存并用于本地识别头',async()=>{
  const r=runtime();await r.open();r.api.math.setRecognitionProvider('local');await settle()
  r.node('ink-endpoint').value='http://127.0.0.1:8767/';await r.fire('ink-endpoint','input')
  assert.equal(await r.api.math.recognizeInk(),false);assert.match(r.node('ink-feedback').textContent,/先点击.*连接服务/)
  assert.equal(r.calls.some(call=>call.url.startsWith('http:')),false)
  assert.equal(await r.api.math.connectRecognition(),true)
  assert.equal(r.api.math.endpoint,'http://127.0.0.1:8767')
  const connection=r.calls.find(call=>call.url.endsWith('/api/recognition/connect'))
  assert.equal(connection.method,'POST');assert.equal(connection.credentials,'omit')
  assert.equal(await r.api.math.recognizeInk(),true)
  const local=r.calls.find(call=>call.url.endsWith('/api/recognition/local'))
  assert.equal(local.headers['X-Anatomy-Recognition-Token'],'session-only-token');assert.equal(local.credentials,'omit');assert.equal(JSON.parse(local.body).mode,'text')
  assert.equal([...r.storage.values()].some(value=>value.includes('session-only-token')),false)
  assert.deepEqual(JSON.parse(r.storage.get('anatomy-recognition:preferences')),{provider:'local',endpoint:'http://127.0.0.1:8767'})
  r.api.math.disconnectRecognition();assert.equal(r.node('ink-disconnect').disabled,true);assert.match(r.node('ink-service').textContent,/已断开/)
  assert.equal(await r.api.math.recognizeInk(),false)
})

test('新服务同源本地识别也优先握手，旧服务仅在空地址时兼容',async()=>{
  for(const modern of[true,false]){
    const r=runtime({preference:{provider:'local',endpoint:''},health:modern?healthy:{service:'anatomy-handwriting',ready:true}});await r.open()
    assert.equal(await r.api.math.recognizeInk(),true)
    assert.equal(r.calls.some(call=>call.url==='/api/recognition/connect'),modern)
    assert.equal(r.calls.some(call=>call.url==='/api/recognition/local'),modern)
    assert.equal(r.calls.some(call=>call.url==='/api/recognize'),!modern)
  }
})

test('连接地址只接受HTTP本机origin，危险地址不会发出任何请求',async()=>{
  for(const address of['https://localhost:8767','http://example.com','http://127.0.0.1.evil.example','http://user:password@127.0.0.1:8767','http://127.0.0.1:8767/api','http://127.0.0.1:8767/..','http://127.0.0.1:8767?token=bad','http://127.0.0.1:8767#bad']){
    const r=runtime({preference:{provider:'local',endpoint:''}});await r.open();r.node('ink-endpoint').value=address;await r.fire('ink-endpoint','input');const count=r.calls.length
    assert.equal(await r.api.math.connectRecognition(),false,address);assert.equal(r.calls.length,count,address);assert.match(r.node('ink-service').textContent,/HTTP 本机地址/)
  }
  for(const address of['http://localhost:8767','http://[::1]:8767']){const r=runtime({preference:{provider:'local'}});await r.open();r.node('ink-endpoint').value=address;await r.fire('ink-endpoint','input');assert.equal(await r.api.math.connectRecognition(),true)}
})

test('外部本机旧服务不提供token时不能被当作已连接',async()=>{
  const r=runtime({preference:{provider:'local'},fetch:async url=>url.endsWith('/api/recognition/connect')?response({ok:true,service:'anatomy-handwriting',ready:true}):null});await r.open()
  r.node('ink-endpoint').value='http://localhost:8767';await r.fire('ink-endpoint','input')
  assert.equal(await r.api.math.connectRecognition(),false);assert.match(r.node('ink-service').textContent,/未提供连接令牌/);assert.equal(await r.api.math.recognizeInk(),false)
})

test('连接过期token被拒绝且不发识别请求',async()=>{
  const r=runtime({preference:{provider:'local'},fetch:async url=>url.endsWith('/api/recognition/connect')?response({ok:true,token:'expired-token',expiresAt:Date.now()-1}):null});await r.open()
  assert.equal(await r.api.math.connectRecognition(),false);assert.match(r.node('ink-service').textContent,/已过期/)
  assert.equal(r.calls.some(call=>call.url.endsWith('/api/recognition/local')),false)
})

test('提交响应晚到时关闭、换模式、换识别方式或校对输入都会取消known id且不能写入候选',async()=>{
  for(const action of['close','mode','provider','input','endpoint']){
    const work=deferred();let id
    const r=runtime({fetch:async(url,init)=>{if(url==='/api/recognition/agent'&&init.method==='POST'){id=JSON.parse(init.body).id;return work.promise}return null}});await r.open();const before=plain(r.api.board)
    const pending=r.api.math.recognizeInk();await settle();assert.ok(id)
    if(action==='close')await r.fire('ink-close','click')
    if(action==='mode')await r.fire('ink-mode-math','click')
    if(action==='provider')r.api.math.setRecognitionProvider('local')
    if(action==='input'){r.node('ink-result').value='我的校对';await r.fire('ink-result','input')}
    if(action==='endpoint'){r.node('ink-endpoint').value='http://localhost:8767';await r.fire('ink-endpoint','input')}
    await settle();const feedback=r.node('ink-feedback').textContent
    work.resolve(response({ok:true,request:{id,status:'completed',result:{text:'晚到候选',engine:'agent-test',mode:'text'}}}))
    assert.equal(await pending,false,action);assert.equal(r.node('ink-result').value,action==='input'?'我的校对':'',action);assert.equal(r.node('ink-feedback').textContent,feedback,action);assert.deepEqual(plain(r.api.board),before)
    assert.equal(r.calls.filter(call=>call.url==='/api/recognition/agent/'+id+'/cancel').length,1,action)
  }
})

test('等待接管时source或选定revision改变会取消任务，候选不能进入确认',async()=>{
  for(const changed of['source','version']){
    const r=runtime();await r.open();const pending=r.api.math.recognizeInk();await settle();const id=r.api.math.requestId
    if(changed==='source')r.api.change(()=>{r.api.board.elements[0].x+=10})
    else vm.runInNewContext("versionSession.selected={id:'other',revision:'other-revision'}",r.context)
    await r.tick(1000);assert.equal(await pending,false);assert.equal(r.node('ink-result').value,'');assert.equal(r.node('ink-apply').disabled,true);assert.match(r.node('ink-feedback').textContent,/已变化/)
    assert.ok(r.calls.some(call=>call.url==='/api/recognition/agent/'+id+'/cancel'))
  }
})

test('已创建任务等待轮询时关闭立即cancel，迟到GET结果不能恢复候选',async()=>{
  const work=deferred();let id
  const r=runtime({fetch:async(url,init)=>{
    if(url==='/api/recognition/agent'&&init.method==='POST'){id=JSON.parse(init.body).id;return response({ok:true,request:{id,status:'pending'}})}
    if(url==='/api/recognition/agent/'+id&&!init.method)return work.promise
    return null
  }});await r.open();const pending=r.api.math.recognizeInk();await settle();await r.tick(1000)
  assert.ok(r.calls.some(call=>call.url==='/api/recognition/agent/'+id))
  await r.fire('ink-close','click');await settle()
  assert.equal(r.calls.filter(call=>call.url==='/api/recognition/agent/'+id+'/cancel').length,1)
  work.resolve(response({ok:true,request:{id,status:'completed',result:{text:'GET晚到候选',mode:'text'}}}))
  assert.equal(await pending,false);assert.equal(r.node('ink-result').value,'');assert.equal(r.node('ink-dialog').open,false)
})

test('连接握手迟到时切换provider、断开或修改地址均不能恢复连接或继续发token健康请求',async()=>{
  for(const action of['provider','disconnect','endpoint']){
    const work=deferred()
    const r=runtime({preference:{provider:'local',endpoint:'http://127.0.0.1:8767'},fetch:async url=>url.endsWith('/api/recognition/connect')?work.promise:null});await r.open()
    const connecting=r.api.math.connectRecognition();await settle()
    if(action==='provider')r.api.math.setRecognitionProvider('agent')
    if(action==='disconnect')r.api.math.disconnectRecognition()
    if(action==='endpoint'){r.node('ink-endpoint').value='http://localhost:9876';await r.fire('ink-endpoint','input')}
    await settle();work.resolve(response({ok:true,token:'late-connection-token',expiresAt:Date.now()+60000}))
    assert.equal(await connecting,false,action);assert.equal(r.node('ink-disconnect').disabled,true,action)
    assert.equal(r.calls.some(call=>call.url==='http://127.0.0.1:8767/api/recognition/health'),false,action)
    assert.equal([...r.storage.values()].some(value=>value.includes('late-connection-token')),false,action)
    assert.equal(r.api.math.provider,action==='provider'?'agent':'local')
  }
})

test('智能体接管最多等待10分钟，超时立即取消并保留笔迹',async()=>{
  const r=runtime();await r.open();const before=plain(r.api.board),pending=r.api.math.recognizeInk();await settle();const id=r.api.math.requestId
  await r.tick(600000);assert.equal(await pending,false);assert.match(r.node('ink-feedback').textContent,/停止或超时/);assert.equal(r.node('ink-result').value,'');assert.deepEqual(plain(r.api.board),before)
  assert.ok(r.calls.some(call=>call.url==='/api/recognition/agent/'+id+'/cancel'))
})

test('服务错误与格式不符只显示反馈，不应用智能体候选',async()=>{
  for(const kind of['mismatch','failed','wrong-mode']){
    const r=runtime({fetch:async(url,init)=>{
      if(url!=='/api/recognition/agent'||init.method!=='POST')return null
      const id=JSON.parse(init.body).id
      if(kind==='mismatch')return response({ok:true,request:{id:'other-id',status:'completed',result:{text:'错误身份',mode:'text'}}})
      if(kind==='failed')return response({ok:true,request:{id,status:'failed',error:{message:'接管失败'}}})
      return response({ok:true,request:{id,status:'completed',result:{text:'x+1',mode:'math'}}})
    }});await r.open();const before=plain(r.api.board)
    assert.equal(await r.api.math.recognizeInk(),false);assert.equal(r.node('ink-result').value,'');assert.equal(r.node('ink-apply').disabled,true);assert.deepEqual(plain(r.api.board),before)
    assert.match(r.node('ink-feedback').textContent,kind==='mismatch'?/身份不一致/:kind==='failed'?/接管失败/:/格式无效/)
  }
})
