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
function paperText(value){const ok=paperUpdate(d=>{d.text=value},'text');if(ok){$('paper-prose').textContent=value;editError(paperValidation(canvasDraft.value))}return ok}
function paperEquation(id,value){
  return paperUpdate(d=>{if(id==='primary')d.math=value;else{const f=d.mathExpressions?.find(f=>f.id===id);if(f)f.value=value}},'math:'+id)
}
function paperInsert(value=''){
  if(canvasDraft?.kind!=='paper')return null;let id;
  paperUpdate(d=>{if(!d.math?.trim()&&paperActiveExpression!=='primary'){id='primary';d.math=value}else{id=uid();(d.mathExpressions??=[]).push({id,value})}});
  paperActiveExpression=id;renderPaperEquations();focusPaperEquation();return id
}
function paperRemove(id){
  if(canvasDraft?.kind!=='paper')return;
  paperUpdate(d=>{if(id==='primary'){d.math='';delete d.mathHandwriting;if(d.handwriting?.mode==='math')delete d.handwriting}else d.mathExpressions=(d.mathExpressions||[]).filter(f=>f.id!==id)});
  paperActiveExpression=null;renderPaperEquations();$('paper-prose').focus();positionInlineWriting()
}
function paperUndo(redo=false){
  if(canvasDraft?.kind!=='paper')return;const h=paperHistory(),from=redo?h.redo:h.undo,to=redo?h.undo:h.redo;if(!from.length)return;
  to.push(JSON.stringify(canvasDraft.value));canvasDraft.value=JSON.parse(from.pop());h.field=null;h.time=0;
  if(paperActiveExpression&&!paperEntries().some(f=>f.id===paperActiveExpression))paperActiveExpression=null;
  $('paper-prose').textContent=canvasDraft.value.text;renderPaperEquations();editError('');persistCanvasDraft();paperStatus();paperActiveExpression?focusPaperEquation():$('paper-prose').focus();positionInlineWriting()
}
function renderPaperEquations(){
  if(canvasDraft?.kind==='paper')canvasDraft.focusExpression=paperActiveExpression;
  $('paper-equations').innerHTML=paperEntries().map((f,i)=>'<section class="paper-equation'+(f.id===paperActiveExpression?' active':'')+'" data-paper-equation="'+esc(f.id)+'"><div class="paper-math" tabindex="0" role="button" aria-label="编辑公式 '+(i+1)+'">'+(f.value.trim()?mathHTML(f.value):'<span class="paper-placeholder">在这里写数学表达</span>')+'</div>'+(f.id===paperActiveExpression?'<div class="paper-equation-editor"><textarea id="paper-equation-input" aria-label="公式数学记法" spellcheck="false" placeholder="例如 y = ax + b，或 \\frac{a}{b}">'+esc(f.value)+'</textarea><button data-paper-remove="'+esc(f.id)+'" aria-label="删除这条公式" title="删除这条公式">×</button></div><p class="paper-math-hint">数学记法 · Enter 继续写说明 · Esc 收起</p>':'')+'</section>').join('');paperStatus()
}
function focusPaperEquation(){const input=document.getElementById('paper-equation-input');input?.focus();input?.setSelectionRange?.(input.value.length,input.value.length)}
function openPaperEditor(id=chosen()?.id,expression=null){
  if(!startCanvasEdit('paper',id))return;if(view.scale<.45)focusPart(id);closeCanvasEditor();expression=expression||canvasDraft.focusExpression;paperActiveExpression=null;paperActiveExpression=expression&&paperEntries().some(f=>f.id===expression)?expression:null;
  $('paper-title').textContent=partTitle(get(id),A.flows);$('paper-prose').textContent=canvasDraft.value.text;
  $('inline-writing').hidden=false;$('inline-actions').hidden=false;renderScene();renderPaperEquations();positionInlineWriting();renderCanvasTools();paperActiveExpression?focusPaperEquation():$('paper-prose').focus();positionInlineWriting()
}
function closePaper(){closeCanvasEditor();persistCanvasDraft()}
function paperHandwriting(){if(canvasDraft?.kind!=='paper')return;openHandwriting({paper:true,expression:paperActiveExpression})}
function paperInk(value,handwriting,session){
  if(canvasDraft?.kind!=='paper'||canvasDraft.target!==session.target||JSON.stringify(canvasDraft.value)!==session.before)return '文稿已变化，识别结果已保留，请重新打开手写并核对。';
  paperUpdate(d=>{if(handwriting.mode==='text'){d.text+=(d.text?'\n':'')+value;if(d.handwriting?.mode==='math'&&!d.mathHandwriting)d.mathHandwriting=structuredClone(d.handwriting);d.handwriting=handwriting}else{
    const id=session.expression;let f=id==='primary'?{id}:d.mathExpressions?.find(f=>f.id===id);
    if(!f){f=writeMathExpression(d,'append',value);paperActiveExpression=f.id}else if(id==='primary')d.math=value;else f.value=value;
    if(f.id==='primary')d.mathHandwriting=handwriting;else f.handwriting=handwriting;
  }});$('paper-prose').textContent=canvasDraft.value.text;renderPaperEquations();return null
}
$('paper-prose').addEventListener('input',()=>{if(canvasDraft?.kind!=='paper')return;const value=($('paper-prose').innerText??$('paper-prose').textContent).replace(/\r\n?/g,'\n');paperUpdate(d=>{d.text=value},'text');editError(paperValidation(canvasDraft.value))});
$('paper-prose').addEventListener('paste',ev=>{ev.preventDefault();const text=ev.clipboardData?.getData('text/plain')||'';document.execCommand?.('insertText',false,text)});
$('paper-prose').addEventListener('drop',ev=>ev.preventDefault());
$('paper-equations').addEventListener('click',ev=>{const remove=ev.target.closest('[data-paper-remove]');if(remove){paperRemove(remove.dataset.paperRemove);return}if(ev.target.id==='paper-equation-input')return;const row=ev.target.closest('[data-paper-equation]');if(!row)return;paperActiveExpression=row.dataset.paperEquation;paperHistory().field=null;renderPaperEquations();focusPaperEquation()});
$('paper-equations').addEventListener('input',ev=>{if(ev.target.id!=='paper-equation-input')return;paperEquation(paperActiveExpression,ev.target.value);const row=ev.target.closest('[data-paper-equation]'),parsed=formulaMarkup(ev.target.value,katex);if(row?.querySelector('.paper-math'))row.querySelector('.paper-math').innerHTML=parsed.html;editError(parsed.error||paperValidation(canvasDraft.value))});
$('paper-equations').addEventListener('keydown',ev=>{if(ev.isComposing||inlineComposing)return;if(ev.target.id==='paper-equation-input'&&!(ev.ctrlKey||ev.metaKey)&&['Enter','Escape'].includes(ev.key)){ev.preventDefault();ev.stopPropagation?.();paperActiveExpression=null;renderPaperEquations();$('paper-prose').focus()}else if(ev.target.classList?.contains('paper-math')&&['Enter',' '].includes(ev.key)){ev.preventDefault();paperActiveExpression=ev.target.closest('[data-paper-equation]').dataset.paperEquation;renderPaperEquations();focusPaperEquation()}});
$('inline-writing').addEventListener('keydown',ev=>{if(ev.isComposing||inlineComposing)return;const mod=ev.ctrlKey||ev.metaKey;if(mod&&['z','y'].includes(ev.key.toLowerCase())){ev.preventDefault();ev.stopPropagation?.();paperUndo(ev.shiftKey||ev.key.toLowerCase()==='y')}else if(mod&&ev.key==='Enter'){ev.preventDefault();ev.stopPropagation?.();finishInlineWriting()}else if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation?.();cancelCanvasEdit()}else if(ev.altKey&&['=','+'].includes(ev.key)){ev.preventDefault();paperInsert()}});

$('paper-close').addEventListener('click',closePaper);$('paper-confirm').addEventListener('click',confirmCanvasEdit);$('paper-cancel').addEventListener('click',cancelCanvasEdit);
$('paper-insert').addEventListener('click',()=>paperInsert());$('paper-handwriting').addEventListener('click',paperHandwriting);
$('paper-undo').addEventListener('click',()=>paperUndo());$('paper-redo').addEventListener('click',()=>paperUndo(true));
window.__anatomyBoard.canvas.openPaperEditor=openPaperEditor;
window.__anatomyBoard.paper={text:paperText,equation:paperEquation,insert:paperInsert,remove:paperRemove,undo:()=>paperUndo(),redo:()=>paperUndo(true)};

// The only human writing surface is anchored to the part in the main canvas.
var inlineComposing=false;
function inlineWritingOpen(){return canvasDraft?.kind==='paper'&&!$('inline-writing').hidden}
function positionInlineWriting(){
  if(!inlineWritingOpen())return;const e=get(canvasDraft.target);if(!e)return;
  const r=surface.getBoundingClientRect(),parent=surface.parentElement?.getBoundingClientRect?.()||{left:r.left,top:0},line=['line','arrow'].includes(e.type),label=line?lineLabels().find(l=>l.id===e.id):null;
  const centered=['rect','ellipse','diamond','polygon'].includes(e.type),ix=e.type==='diamond'?.72:e.type==='ellipse'?.82:1,iy=e.type==='diamond'?.45:e.type==='ellipse'?.64:1;
  let x=e.x+e.width*(1-ix)/2+12,y=e.y+e.height*(1-iy)/2+10,w=e.width*ix-24,h=e.height*iy-20;
  if(line&&label){x=label.x+8;y=label.y+5;w=label.w-16;h=label.h-10}
  if(e.type==='image'){const caption=Math.min(imageCaptionHeight(e),Math.max(40,e.height-20));y=e.y+e.height-caption+8;h=caption-16}if(e.type==='frame')h=Math.min(130,h);
  const panel=$('inline-writing');panel.style.left=(r.left-parent.left+view.x+x*view.scale)+'px';panel.style.top=(r.top-parent.top+view.y+y*view.scale)+'px';panel.style.width=Math.max(30,w*view.scale)+'px';panel.style.height=Math.max(30,h*view.scale)+'px';
  panel.style.fontSize=Math.max(14,(e.fontSize||16)*view.scale)+'px';panel.style.textAlign=centered?'center':'left';panel.style.justifyContent=centered?'center':'flex-start';panel.style.transformOrigin=((e.x+e.width/2-x)*view.scale)+'px '+((e.y+e.height/2-y)*view.scale)+'px';panel.style.transform='rotate('+(line?0:e.rotation||0)+'deg)';panel.style.color='#24334e';
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
