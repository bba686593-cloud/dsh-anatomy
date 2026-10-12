// A freeform 2D engineering board for this plugin, bound to actual source symbols.
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const dir=resolve(process.argv[2]||join(repo,'anatomy-freeboard'))
const tools=new Map();apply({tools:{register(d){tools.set(d.name,d);return()=>{}}}},{rootDir:repo})
async function call(name,args={}){const r=await tools.get('anatomy_'+name).execute({dir,repoRoot:repo,...args});if(!r.ok)throw Error(JSON.stringify(r,null,2));return r}
await call('init',{body:'freeboard',title:'把理解画出来，把实现连起来',oneline:'在同一张画板上表达工程；点击任何部位，进一步理解它的实现。'})
const impl=(code,file,symbol,note)=>({implementation:{language:'JavaScript',code,note},anchors:[{file,symbol,role:'implementation',reason:note}]})
const shape=(id,type,x,y,width,height,text,extra={})=>({id,type,x,y,width,height,text,fill:'#eff6ff',stroke:'#6366f1',fontSize:19,...extra})
const board={version:1,reading:{summary:'从人的工程意图开始，理解图元检查、实现关联和共读页面的关系。结构有效不代表业务实现正确。',steps:[{element:'intent',title:'先表达目的与边界',description:'人的说明与数学约束记录在图元中，修改连同原工程版本一起传递。'},{element:'check',title:'检查表达是否有效',description:'检查图元几何、引用、导读以及自然语言边界。通过这些检查不能替代业务验证。'},{element:'code',title:'核对实现依据',description:'每个部位独立记录程序表达与源码关联，读完实现才能判断是否满足人的意图。'},{element:'relation',title:'生成共读画板',description:'同一份工程数据生成可读页面，人的后续修改继续保存成带原版本的修改包。'}]},elements:[
 shape('space','frame',20,100,1020,480,'从人的理解，到工程事实',{fill:'none',stroke:'#cbd5e1',fontSize:18}),
 shape('intent-check','arrow',200,270,320,0,'提交图元与关系检查',{from:'intent',to:'check',fill:'none',stroke:'#818cf8',...impl('boardDiagnostics(board, organs, flows)','lib/board.js','boardDiagnostics','保存前核对图元与引用。')}),
 shape('check-code','arrow',520,270,340,0,'通过结构检查后核对实现',{from:'check',to:'code',fill:'none',stroke:'#818cf8'}),
 shape('intent','rect',70,210,255,165,'人描述想要什么\n说明目的、边界和条件',{...impl('boardBundle(base, current, body, baseHash)','lib/board.js','boardBundle','人的修改连同原版本一起传递。')}),
 shape('check','diamond',410,190,230,205,'核对表达\n保留明确意图',{fill:'#faf5ff',stroke:'#a855f7',...impl('boardDiagnostics(board, organs, flows)','lib/board.js','boardDiagnostics','检查图元、自然语言和关联对象。')}),
 shape('code','ellipse',730,210,270,165,'实现落在哪里\n点这里查看程序',{fill:'#ecfdf5',stroke:'#10b981',...impl('elementProgram(element, organs, flows)','lib/board.js','elementProgram','每个图元保存自己的程序表达和源码依据。')}),
 shape('relation','math',120,420,800,100,'其中，说明表达目的；数学关系表达约束。',{math:'工程意图 = 自然语言说明 + 数学关系',fill:'none',stroke:'#6366f1',fontSize:24,...impl('renderAnatomy(body, organs, flows)','lib/render.js','renderAnatomy','从相同数据生成可编辑画板。')}),
 shape('underline','pen',70,390,255,10,'',{points:[[0,.4],[.2,.8],[.4,.3],[.7,.6],[1,.2]],stroke:'#f59e0b',strokeWidth:4,fill:'none',implementation:{language:'',code:'',note:'自由笔迹也可以单独关联实现，目前未填写。'}}),
 shape('note','polygon',720,20,320,60,'形状由你决定',{points:[[0,.15],[.9,0],[1,.8],[.1,1]],fill:'#fffbeb',stroke:'#f59e0b',fontSize:18}),
 shape('intro','text',30,10,640,80,'这是一张自由画板，每个部位都能继续展开。',{fill:'none',stroke:'#334155',fontSize:23}),
 shape('foot','text',35,615,1000,90,'试着移动图形、补一段说明，或画一笔新的关系。\n选中部位 → 程序映射 → 读写实现 → 保存修改',{fill:'none',stroke:'#64748b',fontSize:18}),
]}
await call('board',{board});await call('map',{write:true});await call('digest',{write:true});const rendered=await call('render');console.log(rendered.url||rendered.file);console.log(rendered.hint)
