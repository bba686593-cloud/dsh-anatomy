// Canvas edits are drafts until the complete board passes validation.
function canvasDraftChanged(){return !!canvasDraft&&JSON.stringify(canvasDraft.value)!==JSON.stringify(canvasDraft.before)}
function canvasDraftPending(){return canvasDraftChanged()||canvasDraft?.kind==='paper'&&!!canvasDraft.hasInkDraft}
function editSubset(e,kind){
  if(kind==='text')return e.text||'';
  if(kind==='paper')return structuredClone({text:e.text||e.image?.alt||'',imageAlt:e.image?.alt,math:e.math,mathExpressions:e.mathExpressions,handwriting:e.handwriting,mathHandwriting:e.mathHandwriting});
  if(kind==='program')return structuredClone({implementation:e.implementation,anchors:e.anchors,targets:e.targets});
  return Object.fromEntries(['x','y','width','height','rotation','fontSize','strokeWidth','stroke','fill'].map(k=>[k,e[k]]));
}
function persistCanvasDraft(){try{if(canvasDraftChanged()||canvasDraft?.kind==='paper'&&canvasDraft.hasInkDraft)localStorage.setItem(key+':canvas-editor',JSON.stringify(canvasDraft));else localStorage.removeItem(key+':canvas-editor')}catch{message('编辑草稿无法暂存，请确认修改后保存到项目。')}status();renderCanvasTools()}
function editError(text){const id=canvasDraft?.kind==='paper'?'paper-error':canvasDraft?.kind==='program'?'program-error':canvasDraft?.kind==='style'?'style-error':'canvas-text-error';$(id).textContent=text||''}
function startCanvasEdit(kind,id){
  if(canvasDraftPending()&&(canvasDraft.kind!==kind||canvasDraft.target!==id)){message('请先确认或取消当前编辑。');return false}
  const e=get(id);if(!e){message('原部位已变化，请重新选择。');return false}
  flushField();if(!canvasDraft||canvasDraft.kind!==kind||canvasDraft.target!==id){const before=editSubset(e,kind);canvasDraft={kind,target:id,before,value:structuredClone(before)}}
  selected=new Set([id]);tab='human';renderScene();editError('');return true
}
function closeCanvasEditor(){inlineComposing=false; $('canvas-text-editor').hidden=true;$('inline-writing').hidden=true;$('inline-actions').hidden=true;for(const id of ['paper-dialog','program-dialog','style-dialog'])if($(id).open)$(id).close() }
function cancelCanvasEdit(){if(canvasDraft?.kind==='paper'){try{const ink=loadInkDraft();if(ink?.paperSession?.target===canvasDraft.target)localStorage.removeItem(inkDraftKey)}catch{}}canvasDraft=null;try{localStorage.removeItem(key+':canvas-editor')}catch{message('浏览器无法清除旧草稿，请保存已确认的内容。')}closeCanvasEditor();render();status()}
function confirmCanvasEdit(){
  if(!canvasDraft)return false;if(canvasDraft.kind==='paper'&&canvasDraft.hasInkDraft){editError('还有未确认的手写内容。请打开手写输入，校对后放入文稿，或清空笔迹与结果。');return false}const e=get(canvasDraft.target);
  if(!e||JSON.stringify(editSubset(e,canvasDraft.kind))!==JSON.stringify(canvasDraft.before)){editError('原内容已变化。草稿已保留，请取消后重新打开并核对。');return false}
  const candidate=structuredClone(e);
  if(canvasDraft.kind==='paper'){const error=paperValidation(canvasDraft.value);if(error){editError(error);return false}}
  if(canvasDraft.kind==='text')candidate.text=canvasDraft.value;
  else for(const [name,value]of Object.entries(canvasDraft.kind==='paper'?editSubset(canvasDraft.value,'paper'):canvasDraft.value)){if(name==='imageAlt')continue;if(value===undefined)delete candidate[name];else candidate[name]=structuredClone(value)}
  if(candidate.type==='image'&&canvasDraft.kind==='paper'){candidate.image.alt=candidate.text;candidate.height+=Math.max(0,imageCaptionHeight(candidate)-imageCaptionHeight(e))}
  const error=commitExpression(candidate,false);if(error){editError(error);return false}
  cancelCanvasEdit();saveLocal();message('已确认修改，可撤销；保存后供 AI 严格对照。');return true
}
function placeCanvasPanel(panel,e,wide=false){
  const r=surface.getBoundingClientRect(),parent=surface.parentElement?.getBoundingClientRect?.()||{left:r.left,top:0};
  const ox=r.left-parent.left,oy=r.top-parent.top,w=Math.min(wide?560:720,Math.max(1,r.width-16));
  panel.style.width=w+'px';const h=panel.offsetHeight||(wide?230:80);
  const x=ox+Math.max(8,Math.min(r.width-w-8,view.x+e.x*view.scale));
  const top=view.y+e.y*view.scale,bottom=top+e.height*view.scale;
  const y=oy+Math.max(8,Math.min(r.height-h-8,top>h+12?top-h-10:bottom+10));
  panel.style.width=w+'px';panel.style.left=x+'px';panel.style.top=y+'px';
}
function renderCanvasTools(){
  const toolbar=$('canvas-tools'),e=chosen();toolbar.hidden=!e||tool!=='select'||!!drag||!$('canvas-text-editor').hidden||!$('inline-writing').hidden;
  $('resume-edit').hidden=!(canvasDraftChanged()||canvasDraft?.kind==='paper'&&canvasDraft.hasInkDraft)||(!$('canvas-text-editor').hidden||!$('inline-writing').hidden||$('program-dialog').open||$('style-dialog').open);
  if(toolbar.hidden)return;
  $('canvas-selection-title').textContent=selected.size>1?'已选 '+selected.size+' 个部位':partTitle(e,A.flows);
  for(const button of toolbar.querySelectorAll?.('[data-single]')||[])button.hidden=selected.size!==1;
  placeCanvasPanel(toolbar,e);toolbar.style.width='auto';toolbar.style.maxWidth='calc(100% - 16px)';
}
function renderEditor(){if(inlineWritingOpen())positionInlineWriting();if(canvasDraft?.kind==='text'&&!$('canvas-text-editor').hidden){const e=get(canvasDraft.target);if(e)placeCanvasPanel($('canvas-text-editor'),e,true)}renderCanvasTools()}
function openTextEditor(id=chosen()?.id){if(!startCanvasEdit('text',id))return;closeCanvasEditor();$('canvas-text-title').textContent='修改说明 · '+partTitle(get(id),A.flows);$('canvas-text-input').value=canvasDraft.value;$('canvas-text-editor').hidden=false;renderEditor();$('canvas-text-input').focus()}
function programFields(){
  const d=canvasDraft.value;inspector.innerHTML=field('implementation.language','程序语言',d.implementation?.language||'')+field('implementation.code','程序表达',d.implementation?.code||'','textarea','code')+field('implementation.note','实现说明',d.implementation?.note||'','textarea')+'<h3>源码关联</h3><p class="hint">保留已有源码指纹；文件变化必须由 AI 复核，不能通过普通编辑重置。</p>'+(d.anchors||[]).map((a,i)=>'<section class="anchor">'+field('anchors.'+i+'.file','文件路径',a.file)+field('anchors.'+i+'.symbol','符号',a.symbol||'')+field('anchors.'+i+'.role','关联用途',a.role||'')+field('anchors.'+i+'.reason','关联理由',a.reason||'')+'<button data-remove-anchor="'+i+'">移除此关联</button></section>').join('')+'<button data-add-anchor>新增源码关联</button><h3>工程对象</h3>'+[['organ',A.organs],['flow',A.flows]].flatMap(([kind,list])=>list.map(o=>'<label class="binding"><input type="checkbox" data-binding="'+esc(kind+':'+o.id)+'"'+((d.targets||[]).some(t=>t.kind===kind&&t.id===o.id)?' checked':'')+'> '+esc(o.name||o.id)+'</label><details class="linked"><summary>查看程序定义</summary><pre>'+esc(JSON.stringify(o,null,2))+'</pre></details>')).join('')+'<details class="linked"><summary>完整机读映射</summary><pre>'+esc(JSON.stringify({...get(canvasDraft.target),...d},null,2))+'</pre></details>';
}
function openProgram(id=chosen()?.id){if(!startCanvasEdit('program',id))return;closeCanvasEditor();$('program-title').textContent='程序映射 · '+partTitle(get(id),A.flows);programFields();$('program-dialog').showModal();renderCanvasTools()}
function openStyle(id=chosen()?.id){if(!startCanvasEdit('style',id))return;closeCanvasEditor();const d=canvasDraft.value;$('style-content').innerHTML=[['x','横向位置'],['y','纵向位置'],['width','宽度'],['height','高度'],['rotation','旋转角度'],['fontSize','文字大小'],['strokeWidth','线条宽度']].map(([k,label])=>field(k,label,d[k]??(k==='rotation'?0:k==='fontSize'?16:k==='strokeWidth'?2:0),'number')).join('')+field('stroke','线条颜色',d.stroke||'#6366f1')+field('fill','填充颜色（无填充用 none）',d.fill||'none');$('style-dialog').showModal();renderCanvasTools()}
function resumeCanvasEdit(){if(!canvasDraft)return;const {kind,target}=canvasDraft;if(kind==='paper')openPaperEditor(target);else if(kind==='text')openTextEditor(target);else if(kind==='program')openProgram(target);else openStyle(target)}
function setDraftField(path,value){const keys=path.split('.');let obj=canvasDraft.value;for(const k of keys.slice(0,-1)){if(obj[k]===undefined)obj[k]={};obj=obj[k]}obj[keys.at(-1)]=value;editError('');persistCanvasDraft()}
function canvasAction(action){
  if(canvasDraftPending()){message('请先确认或取消当前编辑。');return}
  if(action==='text')openPaperEditor();else if(action==='append')openFormulaLibrary({mode:'append'});else if(action==='expressions')openExpressions();else if(action==='ink')openHandwriting();else if(action==='program')openProgram();else if(action==='style')openStyle();else if(action==='duplicate')duplicate();else if(action==='front'||action==='back')change(()=>{const picked=board.elements.filter(e=>selected.has(e.id)),rest=board.elements.filter(e=>!selected.has(e.id));board.elements=action==='front'?[...rest,...picked]:[...picked,...rest]});else if(action==='delete')remove();else if(action==='dismiss')select(null)
}
function openExpressions(){const e=chosen();if(!e)return;$('expressions-dialog').dataset.target=e.id;$('expressions-content').innerHTML=elementMathEntries(e).map((f,i)=>'<section class="expression-card"><p>数学表达 '+(i+1)+'</p><div class="math-preview">'+mathHTML(humanText(f.value))+'</div><div class="row"><button data-edit-expression="'+esc(f.id)+'">编辑表达</button><button data-ink-expression="'+esc(f.id)+'">继续手写</button><button data-remove-expression="'+esc(f.id)+'">删除表达</button></div></section>').join('')||'<p class="hint">这个部位还没有数学表达。</p>';$('expressions-dialog').showModal()}
$('canvas-tools').addEventListener('click',ev=>{const b=ev.target.closest('[data-canvas-action]');if(b)canvasAction(b.dataset.canvasAction)});
$('canvas-text-input').addEventListener('input',()=>{if(canvasDraft?.kind!=='text')return;canvasDraft.value=$('canvas-text-input').value;editError(programTrace(canvasDraft.value)?'说明请使用自然语言；程序表达放在程序映射中。':'');persistCanvasDraft()});
$('canvas-text-input').addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();cancelCanvasEdit()}else if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();confirmCanvasEdit()}});
for(const kind of ['canvas-text','program','style']){$(kind+'-confirm').addEventListener('click',confirmCanvasEdit);$(kind+'-cancel').addEventListener('click',cancelCanvasEdit)}
for(const id of ['program-dialog','style-dialog'])$(id).addEventListener('cancel',ev=>{ev.preventDefault();closeCanvasEditor();persistCanvasDraft()});
$('resume-edit').addEventListener('click',resumeCanvasEdit);
inspector.addEventListener('input',ev=>{if(canvasDraft?.kind==='program'&&ev.target.dataset.field)setDraftField(ev.target.dataset.field,ev.target.value)});
inspector.addEventListener('change',ev=>{if(canvasDraft?.kind!=='program'||!ev.target.dataset.binding)return;const [kind,id]=ev.target.dataset.binding.split(':');const list=canvasDraft.value.targets??=[];if(ev.target.checked){if(!list.some(t=>t.kind===kind&&t.id===id))list.push({kind,id})}else canvasDraft.value.targets=list.filter(t=>t.kind!==kind||t.id!==id);persistCanvasDraft()});
inspector.addEventListener('click',ev=>{if(canvasDraft?.kind!=='program')return;const add=ev.target.closest('[data-add-anchor]'),remove=ev.target.closest('[data-remove-anchor]');if(add){(canvasDraft.value.anchors??=[]).push({file:''});programFields();persistCanvasDraft()}else if(remove){canvasDraft.value.anchors.splice(Number(remove.dataset.removeAnchor),1);programFields();persistCanvasDraft()}});
$('style-content').addEventListener('input',ev=>{if(canvasDraft?.kind!=='style'||!ev.target.dataset.field)return;setDraftField(ev.target.dataset.field,ev.target.type==='number'?(ev.target.value.trim()===''?null:Number(ev.target.value)):ev.target.value)});
$('expressions-close').addEventListener('click',()=>$('expressions-dialog').close());
$('expressions-content').addEventListener('click',ev=>{const b=ev.target.closest('[data-edit-expression],[data-ink-expression],[data-remove-expression]');if(!b)return;const e=get($('expressions-dialog').dataset.target);if(!e||canvasDraftPending()){message('请先确认当前编辑，或重新选择原部位。');return}select(e.id);if(b.dataset.editExpression){$('expressions-dialog').close();openFormulaLibrary({mode:'edit',expression:b.dataset.editExpression})}else if(b.dataset.inkExpression){$('expressions-dialog').close();openHandwriting({expression:b.dataset.inkExpression})}else{const candidate=structuredClone(e),id=b.dataset.removeExpression;if(id==='primary'){candidate.math='';delete candidate.mathHandwriting;if(candidate.handwriting?.mode==='math')delete candidate.handwriting}else candidate.mathExpressions=(candidate.mathExpressions||[]).filter(f=>f.id!==id);const error=commitExpression(candidate,false);if(error)message(error);else openExpressions()}});
function validCanvasDraft(d){
  if(!d||!['paper','text','program','style'].includes(d.kind)||typeof d.target!=='string')return false;
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const valid=v=>d.kind==='text'?typeof v==='string':object(v)&&(d.kind!=='paper'||typeof v.text==='string'&&(v.math===undefined||typeof v.math==='string')&&(v.mathExpressions===undefined||Array.isArray(v.mathExpressions)&&v.mathExpressions.every(f=>object(f)&&typeof f.id==='string'&&typeof f.value==='string')))&&(d.kind!=='program'||((v.implementation===undefined||object(v.implementation))&&(v.anchors===undefined||Array.isArray(v.anchors)&&v.anchors.every(object))&&(v.targets===undefined||Array.isArray(v.targets)&&v.targets.every(object))));
  return valid(d.before)&&valid(d.value)
}
try{const draft=JSON.parse(localStorage.getItem(key+':canvas-editor')||'null');if(validCanvasDraft(draft))canvasDraft=draft;else if(draft)message('无法恢复编辑草稿，原缓存已保留。')}catch{message('无法读取编辑草稿，原缓存已保留。')}
renderEditor();status();
window.__anatomyBoard.canvas={openTextEditor,openProgram,openStyle,confirm:confirmCanvasEdit,cancel:cancelCanvasEdit,resume:resumeCanvasEdit,get draft(){return canvasDraft}};
