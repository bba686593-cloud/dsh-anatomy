// A paper draft owns human content only. Source mappings stay on the live element.
var paperActiveExpression=null,paperHistoryOwner=null;
function paperEntries(){const d=canvasDraft?.value;return d?[...(typeof d.math==='string'&&d.math.trim()||paperActiveExpression==='primary'?[{id:'primary',value:d.math||''}]:[]),...(d.mathExpressions||[])]:[]}
function paperValidation(d){
  if(programTrace(d.text))return '文稿请使用自然语言；程序表达放在程序映射中。';
  for(const f of [{id:'primary',value:d.math||''},...(d.mathExpressions||[])]){
    if(!f.value.trim())continue;
    if(programTrace(f.value))return '公式请使用数学语言；程序表达放在程序映射中。';
    const parsed=formulaMarkup(f.value,katex);if(parsed.error)return '请修正公式：'+parsed.error;
  }
  return null
}
function paperHistory(){
  if(paperHistoryOwner!==canvasDraft){
    paperHistoryOwner=canvasDraft;const h=canvasDraft?.history;
    const valid=list=>Array.isArray(list)&&list.length<=60&&list.every(s=>{if(typeof s!=='string'||s.length>2000000)return false;try{const v=JSON.parse(s);return validCanvasDraft({kind:'paper',target:canvasDraft.target,before:v,value:v})}catch{return false}});
    if(!h||!valid(h.undo)||!valid(h.redo)){if(h)message('撤销记录无法恢复，当前文稿草稿仍保留。');canvasDraft.history={undo:[],redo:[],field:null,time:0}}
  }
  return canvasDraft.history
}
function paperUpdate(fn,field=null){
  if(canvasDraft?.kind!=='paper')return false;
  const before=JSON.stringify(canvasDraft.value),h=paperHistory();fn(canvasDraft.value);
  if(before===JSON.stringify(canvasDraft.value))return true;
  if(!field||h.field!==field||Date.now()-h.time>750){h.undo.push(before);while(h.undo.length>60||h.undo.length>1&&h.undo.reduce((n,s)=>n+s.length,0)>2000000)h.undo.shift()}
  h.field=field;h.time=Date.now();h.redo=[];editError('');persistCanvasDraft();paperStatus();return true
}
function paperStatus(){if(canvasDraft?.kind!=='paper')return;const h=paperHistory();$('paper-undo').disabled=!h.undo.length;$('paper-redo').disabled=!h.redo.length;$('paper-state').textContent=canvasDraftChanged()?'点击画板其他位置完成':'直接在画板上修改'}
function paperText(value){const ok=paperUpdate(d=>{d.text=value},'text');if(ok){$('paper-prose').textContent=value;editError(paperValidation(canvasDraft.value));positionInlineWriting()}return ok}
function paperEquation(id,value){
  return paperUpdate(d=>{if(id==='primary')d.math=value;else{const f=d.mathExpressions?.find(f=>f.id===id);if(f)f.value=value}},'math:'+id)
}
function paperAppendEquation(value=''){
  if(canvasDraft?.kind!=='paper')return null;let id;
  paperUpdate(d=>{if(!d.math?.trim()&&paperActiveExpression!=='primary'){id='primary';d.math=value}else{id=uid();(d.mathExpressions??=[]).push({id,value})}});
  paperActiveExpression=id;canvasDraft.focusExpression=id;renderPaperEquations();focusPaperEquation();return id
}
function paperInsert(){if(inlineWritingOpen()&&!finishInlineWriting())return null;openFormulaLibrary();return null}
function paperRemove(id){
  if(canvasDraft?.kind!=='paper')return;
  paperUpdate(d=>{if(id==='primary'){d.math='';delete d.mathHandwriting;if(d.handwriting?.mode==='math')delete d.handwriting}else d.mathExpressions=(d.mathExpressions||[]).filter(f=>f.id!==id)});
  paperActiveExpression=null;if(canvasDraft.focusExpression===id)canvasDraft.focusExpression=null;renderPaperEquations();$('paper-prose').focus();positionInlineWriting()
}
function paperUndo(redo=false){
  if(canvasDraft?.kind!=='paper')return;const h=paperHistory(),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo;if(!from.length)return;
  to.push(JSON.stringify(canvasDraft.value));canvasDraft.value=JSON.parse(from.pop());h.field=null;h.time=0;
  if(paperActiveExpression&&!paperEntries().some(f=>f.id===paperActiveExpression))paperActiveExpression=null;
  $('paper-prose').textContent=canvasDraft.value.text;renderPaperEquations();editError('');persistCanvasDraft();paperStatus();paperActiveExpression?focusPaperEquation():$('paper-prose').focus();positionInlineWriting()
}
function renderPaperEquations(){
  // Formula graphics stay on the canvas. This layer edits prose only.
  $('paper-equations').innerHTML='';$('paper-equations').hidden=true;$('paper-equations').style.display='none';paperStatus()
}
function focusPaperEquation(){if(inlineWritingOpen())$('paper-prose').focus()}
function openPaperEditor(id=chosen()?.id,expression=null){
  const e=get(id);if(!e)return false;
  if(expression||e.type==='math'&&!e.text?.trim()||e.type==='image'&&e.formulaGraphic){
    if(inlineWritingOpen()&&!finishInlineWriting())return false;
    if(select(id)!==false)message('公式按图形操作，可擦除、补画或从公式库粘贴。');return false
  }
  if(!startCanvasEdit('paper',id))return false;if(view.scale<.45)focusPart(id);closeCanvasEditor();paperActiveExpression=null;
  $('paper-title').textContent=partTitle(get(id),A.flows);$('paper-prose').textContent=canvasDraft.value.text;
  $('inline-writing').hidden=false;$('inline-actions').hidden=false;renderScene();renderPaperEquations();positionInlineWriting();renderCanvasTools();$('paper-prose').focus();positionInlineWriting();return true
}
function closePaper(){closeCanvasEditor();persistCanvasDraft()}
function paperHandwriting(){if(inlineWritingOpen()&&!finishInlineWriting())return;setTool('pen')}
function paperInk(value,handwriting,session){
  if(canvasDraft?.kind!=='paper'||canvasDraft.target!==session.target||JSON.stringify(canvasDraft.value)!==session.before)return '文稿已变化，识别结果已保留，请重新打开手写并核对。';
  paperUpdate(d=>{if(handwriting.mode==='text'){d.text+=(d.text?'\n':'')+value;if(d.handwriting?.mode==='math'&&!d.mathHandwriting)d.mathHandwriting=structuredClone(d.handwriting);d.handwriting=handwriting}else{
    const id=session.expression;let f=id==='primary'?{id}:d.mathExpressions?.find(f=>f.id===id);
    if(!f){f=writeMathExpression(d,'append',value);paperActiveExpression=f.id}else if(id==='primary')d.math=value;else f.value=value;
    if(f.id==='primary')d.mathHandwriting=handwriting;else f.handwriting=handwriting;
  }});$('paper-prose').textContent=canvasDraft.value.text;renderPaperEquations();positionInlineWriting();return null
}
$('paper-prose').addEventListener('input',()=>{if(canvasDraft?.kind!=='paper')return;const value=($('paper-prose').innerText??$('paper-prose').textContent).replace(/\r\n?/g,'\n');paperUpdate(d=>{d.text=value},'text');editError(paperValidation(canvasDraft.value));positionInlineWriting()});
$('paper-prose').addEventListener('paste',ev=>{ev.preventDefault();const text=ev.clipboardData?.getData('text/plain')||'';document.execCommand?.('insertText',false,text)});
$('paper-prose').addEventListener('drop',ev=>ev.preventDefault());
$('inline-writing').addEventListener('keydown',ev=>{if(ev.isComposing||inlineComposing)return;const mod=ev.ctrlKey||ev.metaKey;if(mod&&['z','y'].includes(ev.key.toLowerCase())){ev.preventDefault();ev.stopPropagation?.();paperUndo(ev.shiftKey||ev.key.toLowerCase()==='y')}else if(mod&&ev.key==='Enter'){ev.preventDefault();ev.stopPropagation?.();finishInlineWriting()}else if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation?.();cancelCanvasEdit()}else if(ev.altKey&&['=','+'].includes(ev.key)){ev.preventDefault();paperInsert()}});

$('paper-close').addEventListener('click',closePaper);$('paper-confirm').addEventListener('click',confirmCanvasEdit);$('paper-cancel').addEventListener('click',cancelCanvasEdit);
$('paper-insert').addEventListener('click',()=>paperInsert());$('paper-handwriting').addEventListener('click',paperHandwriting);
$('paper-undo').addEventListener('click',()=>paperUndo());$('paper-redo').addEventListener('click',()=>paperUndo(true));
window.__anatomyBoard.canvas.openPaperEditor=openPaperEditor;
window.__anatomyBoard.paper={text:paperText,equation:paperEquation,insert:paperAppendEquation,remove:paperRemove,undo:()=>paperUndo(),redo:()=>paperUndo(true)};

// The only human writing surface is anchored to the part in the main canvas.
var inlineComposing=false;
function inlineWritingOpen(){return canvasDraft?.kind==='paper'&&!$('inline-writing').hidden}
function inlineMatrix(a,b){return {a:a.a*b.a+a.c*b.b,b:a.b*b.a+a.d*b.b,c:a.a*b.c+a.c*b.d,d:a.b*b.c+a.d*b.d}}
function inlineCssMatrix(value){
  const m=String(value||'').match(/^matrix\(([^)]+)\)$/),m3=String(value||'').match(/^matrix3d\(([^)]+)\)$/),scale=String(value||'').match(/^scale\(([^)]+)\)$/);
  const values=(m||m3||scale)?.[1].split(/[\s,]+/).filter(Boolean).map(Number);
  if(values?.every(Number.isFinite)){if(m&&values.length===6)return {a:values[0],b:values[1],c:values[2],d:values[3]};if(m3&&values.length===16)return {a:values[0],b:values[1],c:values[4],d:values[5]};if(scale&&values.length)return {a:values[0],b:0,c:0,d:values[1]??values[0]}}
  return {a:1,b:0,c:0,d:1}
}
function inlineComputedStyle(node){try{return typeof getComputedStyle==='function'?getComputedStyle(node):window.getComputedStyle?.(node)||node?.style||{}}catch{return node?.style||{}}}
function inlineTextSlot(e){
  const slot=world.querySelector?.('[data-id="'+e.id+'"] [data-prose-slot]');if(!slot)return null;
  const rect=slot.getBoundingClientRect?.();if(!rect||!(rect.width>0)||!(rect.height>0))return null;
  const foreign=slot.closest?.('foreignObject'),source=foreign?.getScreenCTM?.(),angle=(['line','arrow'].includes(e.type)?0:e.rotation||0)*Math.PI/180;
  let matrix=source?{a:source.a,b:source.b,c:source.c,d:source.d}:{a:view.scale*Math.cos(angle),b:view.scale*Math.sin(angle),c:-view.scale*Math.sin(angle),d:view.scale*Math.cos(angle)};
  let html={a:1,b:0,c:0,d:1};for(let node=slot;node&&node!==foreign;node=node.parentElement){html=inlineMatrix(inlineCssMatrix(inlineComputedStyle(node).transform),html);if(!foreign)break}
  matrix=inlineMatrix(matrix,html);const sx=Math.hypot(matrix.a,matrix.b),sy=Math.hypot(matrix.c,matrix.d),style=inlineComputedStyle(slot);
  if(!(sx>0)||!(sy>0))return null;
  const width=slot.offsetWidth||parseFloat(style.width)||rect.width/sx,height=slot.offsetHeight||parseFloat(style.height)||rect.height/sy;
  return {cx:rect.left+rect.width/2,cy:rect.top+rect.height/2,width,height,matrix,font:parseFloat(style.fontSize)||e.fontSize||16,lineHeight:parseFloat(style.lineHeight)||1.6*(parseFloat(style.fontSize)||e.fontSize||16),style}
}
function positionInlineWriting(){
  if(!inlineWritingOpen())return;const e=get(canvasDraft.target);if(!e)return;
  const r=surface.getBoundingClientRect(),parent=surface.parentElement?.getBoundingClientRect?.()||{left:r.left,top:0},line=['line','arrow'].includes(e.type),label=line?lineLabels().find(l=>l.id===e.id):null;
  const panel=$('inline-writing'),prose=$('paper-prose'),slot=inlineTextSlot(e);
  panel.style.overflow='hidden';panel.style.justifyContent='flex-start';panel.style.color='#24334e';prose.style.width='100%';prose.style.height='100%';prose.style.minHeight='0';prose.style.flex='none';prose.style.overflow='auto';prose.style.lineHeight='inherit';
  if(slot){
    // Keep the source's unscaled text box and apply its complete linear matrix.
    // The actual bounding-box center includes SVG rotation and HTML fitting.
    panel.style.left=(slot.cx-parent.left-slot.width/2)+'px';panel.style.top=(slot.cy-parent.top-slot.height/2)+'px';panel.style.width=slot.width+'px';panel.style.height=slot.height+'px';panel.style.fontSize=slot.font+'px';panel.style.lineHeight=slot.lineHeight+'px';panel.style.textAlign=slot.style.textAlign||'left';panel.style.fontFamily=slot.style.fontFamily||'inherit';panel.style.fontWeight=slot.style.fontWeight||'normal';panel.style.fontStyle=slot.style.fontStyle||'normal';panel.style.letterSpacing=slot.style.letterSpacing||'normal';panel.style.transformOrigin='50% 50%';panel.style.transform='matrix('+[slot.matrix.a,slot.matrix.b,slot.matrix.c,slot.matrix.d,0,0].join(',')+')';return
  }
  const centered=['rect','ellipse','diamond','polygon'].includes(e.type),ix=e.type==='diamond'?.72:e.type==='ellipse'?.82:1,iy=e.type==='diamond'?.45:e.type==='ellipse'?.64:1;
  let x=e.x+e.width*(1-ix)/2+12,y=e.y+e.height*(1-iy)/2+10,w=e.width*ix-24,h=e.height*iy-20;
  if(['text','math'].includes(e.type)){x=e.x;y=e.y;w=e.width;h=e.height}
  if(line&&label){x=label.x+8;y=label.y+5;w=label.w-16;h=label.h-10}
  if(e.type==='image'){const caption=Math.min(imageCaptionHeight(e),Math.max(40,e.height-20));y=e.y+e.height-caption+8;h=caption-16}if(e.type==='frame')h=Math.min(130,h);
  const font=line&&label?label.font:e.fontSize||16,textHeight=Math.max(font*1.6,textLines(e.text||e.image?.alt||'',Math.max(1,w),font).length*font*1.6);h=Math.min(Math.max(1,h),textHeight);
  panel.style.left=(r.left-parent.left+view.x+x*view.scale)+'px';panel.style.top=(r.top-parent.top+view.y+y*view.scale)+'px';panel.style.width=Math.max(1,w*view.scale)+'px';panel.style.height=Math.max(1,h*view.scale)+'px';
  panel.style.fontSize=font*view.scale+'px';panel.style.lineHeight=font*1.6*view.scale+'px';panel.style.textAlign=centered?'center':'left';panel.style.transformOrigin=((e.x+e.width/2-x)*view.scale)+'px '+((e.y+e.height/2-y)*view.scale)+'px';panel.style.transform='rotate('+(line?0:e.rotation||0)+'deg)';
}
function finishInlineWriting(){
  if(!inlineWritingOpen())return !canvasDraftPending();
  if(inlineComposing){editError('请先完成当前输入，再继续操作画板。');return false}
  if(!canvasDraftPending()){cancelCanvasEdit();return true}
  return confirmCanvasEdit()
}
$('paper-prose').addEventListener('compositionstart',()=>inlineComposing=true);$('paper-prose').addEventListener('compositionend',()=>inlineComposing=false);
$('inline-writing').addEventListener('pointerdown',ev=>ev.stopPropagation?.());
$('inline-writing').addEventListener('wheel',ev=>ev.stopPropagation?.());
document.addEventListener('pointerdown',ev=>{
  if(!inlineWritingOpen()||ev.target.closest?.('#inline-writing,#inline-actions,dialog,#undo,#redo'))return;
  if(!finishInlineWriting()){ev.preventDefault?.();ev.stopPropagation?.()}
},true);
window.__anatomyBoard.canvas.finishInline=finishInlineWriting;

$('inline-writing').addEventListener('compositionstart',()=>inlineComposing=true);$('inline-writing').addEventListener('compositionend',()=>inlineComposing=false);
