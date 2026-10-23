import test from 'node:test'
import assert from 'node:assert/strict'
import {readingRoutes,relationName,relationLabelLayout,hasRelationLabel,partTitle} from '../lib/reading.js'
import {boardFor,lineEnds} from '../lib/board.js'
import {humanMap,agentDigest} from '../lib/digest.js'
test('旧工程优先沿已有场景阅读，缺失场景不猜测执行次序',()=>{
 const organs=[{id:'a',name:'接收',gist:'接收输入'},{id:'b',name:'交付',gist:'交付结果'}],flows=[{id:'ab',name:'待处理数据',from:'a',to:'b'}],board=boardFor({},organs,flows);
 const routes=readingRoutes(board,{scenarios:[{id:'check',name:'核对结果',steps:[{organ:'b',action:'核对交付'},{organ:'a',action:'检查输入'}]}]},organs,flows);
 assert.deepEqual(routes[0].steps.map(s=>s.element),['organ-b','organ-a']);assert.equal(routes[0].steps[0].description,'核对交付');assert.equal(readingRoutes(board)[0].id,'directory');assert.match(readingRoutes(board)[0].basis,/不代表执行顺序/)
})
test('关系名优先显式说明，回退已有工程流，再缺失时标待说明',()=>{
 const e={type:'arrow',text:' ',targets:[{kind:'flow',id:'f'}]},flows=[{id:'f',name:'检查通过的结果'}];assert.equal(relationName(e,flows),'检查通过的结果');assert.equal(relationName({...e,text:'只在成功时交付'},flows),'只在成功时交付');assert.equal(relationName(e),'关系待说明');assert.ok(!relationName({...e,text:'return secret;'}).includes('secret'))
})
test('自由轮廓线和指示箭头不虚构关系标签，实际声明的关系仍保留待说明',()=>{
 const outline={id:'edge',type:'line',x:0,y:0,width:150,height:0},pointer={...outline,id:'pointer',type:'arrow'},linked={...pointer,id:'relation',from:'part'},part={id:'part',type:'polygon',x:200,y:0,width:100,height:100,points:[[0,0],[1,0],[.5,1]]},ink={id:'ink',type:'pen',x:0,y:100,width:80,height:60,points:[[0,0],[1,1]]}
 const board={version:1,elements:[outline,pointer,linked,part,ink]}
 assert.equal(hasRelationLabel(outline),false);assert.equal(hasRelationLabel(pointer),false);assert.equal(hasRelationLabel(linked),true)
 assert.deepEqual(relationLabelLayout(board,[],lineEnds).map(l=>l.id),['relation'])
 assert.equal(partTitle(pointer),'指示箭头');assert.equal(partTitle(ink),'自由笔迹')
 assert.deepEqual(readingRoutes(board)[0].steps.map(s=>s.element),['part','ink'])
 const human=humanMap({board:{...board,elements:[outline,pointer,part,ink]}},[],[])
 assert.ok(!human.includes('关系待说明'))
 assert.equal(hasRelationLabel({...outline,math:'x = 0'}),true)
 assert.equal(relationName({...outline,math:'x = 0'}),'数学标注')
 assert.equal(relationName({...linked,math:'x = 0'}),'关系待说明')
 assert.equal(relationLabelLayout({elements:[{...outline,math:'x = 0'}]},[],lineEnds)[0].text,'数学标注')
 assert.equal(hasRelationLabel({...pointer,targets:[{kind:'flow',id:'f'}]}),true)
})
test('密集交叉与同端点连线的名称不盖住节点或彼此',()=>{
 const elements=[{id:'a',type:'rect',x:0,y:0,width:200,height:100},{id:'b',type:'rect',x:220,y:0,width:200,height:100},{id:'c',type:'rect',x:100,y:120,width:200,height:100,rotation:45}];
 for(let i=0;i<12;i++)elements.push({id:'l'+i,type:'arrow',from:i%2?'c':'a',to:'b',text:'交接条件与内容'+i});const labels=relationLabelLayout({elements},[],lineEnds);assert.equal(labels.length,12);
 const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 for(let i=0;i<labels.length;i++){for(let j=0;j<i;j++)assert.equal(overlap(labels[i],labels[j]),false);for(const e of elements.slice(0,2))assert.equal(overlap(labels[i],{x:e.x,y:e.y,w:e.width,h:e.height}),false)}
})
test('导读和连线名称进入两份摘要，人读摘要不包含实现源码',()=>{
 const board={version:1,elements:[{id:'a',type:'rect',text:'接收输入',implementation:{code:'return input;'}},{id:'l',type:'arrow',text:'通过校验的数据'}],reading:{summary:'处理输入。',steps:[{element:'a',title:'从入口读起',description:'先核对输入边界。'}]}};
 const human=humanMap({title:'工程',board},[],[]),machine=agentDigest({board},[],[]);assert.match(human,/从入口读起/);assert.match(human,/通过校验的数据/);assert.ok(!human.includes('return input;'));assert.match(machine,/先核对输入边界/);assert.match(machine,/return input;/)
})
