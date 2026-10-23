import test from 'node:test'
import assert from 'node:assert/strict'
import { autoLayout, layoutBox, boxesOverlap } from '../lib/layout.js'
import { spaceStrokePoints } from '../lib/board-space.js'
const shape=(id,x,y,w=220,h=90,type='rect')=>({id,type,x,y,width:w,height:h,text:'检查数据并说明边界',math:'y = f(x)',implementation:{code:'return input;'}})
test('密集图元与扩展文字自动避让且幂等，关系与映射保留',()=>{const b={version:1,elements:[shape('a',20,20),shape('b',30,30),shape('c',40,40),{id:'edge',type:'arrow',x:0,y:0,width:0,height:0,from:'a',to:'b',text:'输入数据'}]},next=autoLayout(b,{a:{height:500,width:400}});const nodes=next.elements.slice(0,3);for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)assert.equal(boxesOverlap(layoutBox(nodes[i]),layoutBox(nodes[j])),false);assert.deepEqual(next.elements[3],b.elements[3]);assert.equal(nodes[0].implementation.code,'return input;');assert.deepEqual(autoLayout(next),next);assert.equal(b.elements[0].height,90)})
test('分区扩展后相邻分区移动并带走内部图元，标题与旋转图形避让',()=>{const b={version:1,elements:[shape('f',0,0,500,200,'frame'),shape('a',20,15),shape('b',20,100),shape('g',0,230,500,200,'frame'),shape('c',20,280)]};b.elements[1].rotation=25;const next=autoLayout(b,{a:{height:300}}),[f,a,bb,g,c]=next.elements;assert.equal(boxesOverlap(layoutBox(f),layoutBox(g)),false);assert.ok(layoutBox(a).y>=f.y+76);assert.ok(c.y>=g.y+76);assert.ok(g.y>230);assert.ok(f.height>200);assert.equal(boxesOverlap(layoutBox(a),layoutBox(bb)),false);assert.deepEqual(autoLayout(next),next)})
test('嵌套分区避让父级标题与左边距时递归平移内容，保持内部间距',()=>{
  const b={version:1,elements:[shape('outer',0,0,700,700,'frame'),shape('inner',10,10,600,500,'frame'),shape('node',20,20,200,100)]}
  const measured={outer:{headerHeight:120},inner:{headerHeight:105}},next=autoLayout(b,measured),[outer,inner,node]=next.elements
  assert.equal(inner.x,outer.x+20)
  assert.equal(inner.y,outer.y+120)
  assert.equal(node.x,inner.x+20)
  assert.equal(node.y,inner.y+105)
  assert.ok(node.x+node.width<=inner.x+inner.width)
  assert.ok(node.y+node.height<=inner.y+inner.height)
  assert.deepEqual(node.implementation,b.elements[2].implementation)
  assert.deepEqual(autoLayout(next,measured),next)
  assert.equal(b.elements[2].x,20)
  assert.equal(b.elements[2].y,20)
})
test('默认展示与字体测量保留空间构图，只有明确二维重排才改坐标',()=>{
  for(const field of [{z:0},{rotationX:0},{rotationY:35},{extrusion:-40},{points3d:[[0,0,0],[100,100,20]]}]){
    const b={version:1,elements:[{...shape('a',0,0),...field},shape('b',0,0)]},before=structuredClone(b)
    assert.deepEqual(autoLayout(b,{a:{width:900,height:800}}),before)
    assert.notDeepEqual(autoLayout(b,{}, {spatial:true}),before)
    assert.deepEqual(b,before)
  }
})
test('分区被标题撑开后带走自由连线，双向和负尺寸保持原样',()=>{
  const b={version:1,elements:[shape('f',0,0,500,200,'frame'),shape('a',20,100,100,50),shape('g',0,230,500,200,'frame'),{id:'free',type:'arrow',direction:'two-way',x:120,y:330,width:-100,height:0},shape('member',200,360,100,60)]}
  const next=autoLayout(b,{f:{headerHeight:400}}),delta=next.elements[2].y-b.elements[2].y
  assert.ok(delta>0)
  assert.equal(next.elements[3].y,b.elements[3].y+delta)
  assert.equal(next.elements[3].width,-100);assert.equal(next.elements[3].direction,'two-way')
  assert.equal(next.elements[4].y,b.elements[4].y+delta)
})
test('显式二维重排同时平移不等采样的绝对三维笔迹与二维图框',()=>{
  const pen={id:'pen',type:'pen',x:0,y:0,z:0,width:100,height:100,points:[[0,0],[1,1]],points3d:[[0,0,0],[50,80,10],[100,100,20]]}
  const b={version:1,elements:[{id:'obstacle',type:'rect',x:0,y:0,width:100,height:100},pen]},before=spaceStrokePoints(pen),next=autoLayout(b,{}, {spatial:true}).elements[1]
  assert.ok(next.y>pen.y)
  assert.deepEqual(spaceStrokePoints(next),before.map(p=>({...p,x:p.x+next.x-pen.x,y:p.y+next.y-pen.y})))
  assert.deepEqual(pen.points3d,[[0,0,0],[50,80,10],[100,100,20]])
})
test('显式分区归属不会被另一个分区的二维包围盒误吸收',()=>{
  const b={version:1,elements:[shape('left',0,0,500,300,'frame'),shape('right',700,0,500,300,'frame'),{...shape('member',20,100,100,60),frame:'right'}]}
  const next=autoLayout(b),right=next.elements[1],member=next.elements[2]
  assert.ok(member.x>=right.x+20);assert.ok(member.y>=right.y+76)
  assert.equal(member.frame,'right')
})
