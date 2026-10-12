// The guide is a separate outline; following it keeps the canvas available.
// Function declarations and var state allow render() to run before this part.
var readingDraft, readingDraftBase, readingDraftError;
function readingDraftChanged(){return readingDraft!==undefined&&JSON.stringify(readingDraft)!==readingDraftBase}
function readingEditorStatus(){if(typeof status==='function')status()}
function persistReadingDraft(){
  try{if(typeof localStorage!=='undefined')localStorage.setItem(key+':reading-editor',JSON.stringify({version:1,reading:readingDraft,base:readingDraftBase??null,error:readingDraftError||''}))}
  catch{if(typeof message==='function')message('浏览器暂时无法保存导读草稿，请保持页面打开并尽快确认修改。')}
  readingEditorStatus()
}
function clearReadingDraftStorage(){try{if(typeof localStorage!=='undefined')localStorage.removeItem(key+':reading-editor')}catch{}readingEditorStatus()}
function readingNavigationAllowed(){if(typeof canvasDraftChanged==='function'&&canvasDraftChanged()){if(typeof message==='function')message('请先确认或取消画板上的编辑，再切换阅读部位。');return false}return true}
function currentRoute(){
  const routes=readingRoutes(board,A.body,A.organs,A.flows);
  return routes.find(r=>r.id===routeId)||routes[0]||{id:'directory',title:'工程部位索引',summary:'工程目的尚未说明。',basis:'尚未编写阅读主线。',steps:[]}
}
function readingActive(){const r=currentRoute();return Number.isInteger(readingIndex)&&readingIndex>=0&&readingIndex<r.steps.length&&Boolean(get(r.steps[readingIndex].element))}
function goReadingStep(index,{close=true}={}){
  const route=currentRoute();if(!Number.isInteger(index)||index<0||index>=route.steps.length||!get(route.steps[index].element)||!readingNavigationAllowed())return false;
  routeId=route.id;readingIndex=index;tab='human';setTool('select');
  if(close&&$('reading-dialog')?.open)$('reading-dialog').close();
  focusPart(route.steps[index].element);renderReading();return true
}
function readingMath(element){return elementMathEntries(element).map(f=>'<div class="reading-card-math math-preview">'+formulaMarkup(humanText(f.value),katex).html+'</div>').join('')}
function readingPartButton(element,attribute='data-reading-part'){
  return '<button '+attribute+'="'+esc(element.id)+'"><span>'+esc(partTitle(element,A.flows))+'</span></button>'
}
function renderReadingEditor(){
  const draft=readingDraft;if(!draft)return '';
  let h='<section class="reading-editor"><h3>编辑工程导读</h3><p class="hint">用自然语言说明目的、条件和边界。阅读顺序用于讲解，不自动代表执行顺序。确认后一起保存到画板；取消会保留原导读。</p>';
  h+='<label class="field">工程目的<textarea data-guide-field="summary">'+esc(draft.summary||'')+'</textarea></label>';
  h+='<div class="reading-editor-steps">'+draft.steps.map((s,i)=>'<section class="reading-editor-step"><h4>第 '+(i+1)+' 步 · '+esc(get(s.element)?partTitle(get(s.element),A.flows):'部位已不存在')+'</h4><label class="field">标题<input data-guide-field="steps.'+i+'.title" value="'+esc(s.title||'')+'"></label><label class="field">阅读说明<textarea data-guide-field="steps.'+i+'.description">'+esc(s.description||'')+'</textarea></label><div class="row"><button data-guide-move="'+i+'" data-guide-direction="-1"'+(i===0?' disabled':'')+'>上移</button><button data-guide-move="'+i+'" data-guide-direction="1"'+(i===draft.steps.length-1?' disabled':'')+'>下移</button><button data-guide-remove="'+i+'">移除步骤</button></div></section>').join('')+'</div>';
  h+='<label class="field">加入阅读步骤<select id="reading-append-element">'+board.elements.map(e=>'<option value="'+esc(e.id)+'"'+(e.id===chosen()?.id?' selected':'')+'>'+esc(partTitle(e,A.flows))+'</option>').join('')+'</select></label><button data-guide-action="append"'+(!board.elements.length?' disabled':'')+'>加入所选部位</button>';
  h+='<p id="reading-error" class="reading-error" role="alert">'+esc(readingDraftError||'')+'</p><div class="reading-editor-actions row"><button class="primary" data-guide-action="confirm">确认修改导读</button><button data-guide-action="cancel">取消修改</button></div></section>';return h
}
function renderReading(){
  const route=currentRoute();if(readingIndex>=route.steps.length||readingIndex< -1)readingIndex=-1;
  const active=readingActive()?route.steps[readingIndex]:null,element=active&&get(active.element),card=$('reading-card');
  document.body.classList.toggle('reading-mode',Boolean(active));
  if(card)card.hidden=!active;
  if($('reading-card-title'))$('reading-card-title').textContent=active?humanText(active.title||partTitle(element,A.flows)):'';
  if($('reading-card-description'))$('reading-card-description').innerHTML=active?'<p>'+esc(humanText(active.description||element.text||''))+'</p>'+readingMath(element):'';
  if($('reading-card-progress'))$('reading-card-progress').textContent=active?'第 '+(readingIndex+1)+' / '+route.steps.length+' 步 · '+humanText(route.title):'';
  if($('reading-prev'))$('reading-prev').disabled=!active||readingIndex<=0;
  if($('reading-next'))$('reading-next').disabled=!active||readingIndex>=route.steps.length-1;
  for(const id of ['reading-map','reading-describe'])if($(id))$(id).disabled=!active;
  const content=$('reading-content');if(!content)return;
  if(editReading&&readingDraft){content.innerHTML=renderReadingEditor();return}
  const routes=readingRoutes(board,A.body,A.organs,A.flows);
  let h='<section class="reading-purpose"><h3>工程目的</h3><p>'+esc(humanText(route.summary||'工程目的尚未说明。'))+'</p><p class="hint">'+esc(humanText(route.basis))+'</p></section>';
  if(routes.length>1)h+='<label class="field">阅读路线<select id="reading-route">'+routes.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===route.id?' selected':'')+'>'+esc(humanText(r.title))+'</option>').join('')+'</select></label>';
  h+='<h3>'+esc(humanText(route.title))+'</h3>';
  h+=route.steps.length?'<ol class="reading-steps">'+route.steps.map((s,i)=>'<li><button data-reading-step="'+i+'" aria-current="'+(active&&i===readingIndex?'step':'false')+'"><b>'+esc(humanText(s.title))+'</b><span>'+esc(humanText(s.description||''))+'</span></button></li>').join('')+'</ol>':'<p class="hint">先在画板放下部位，再为它们编写阅读主线。</p>';
  h+='<button data-guide-action="edit">'+(board.reading?'编辑工程导读':'编写工程导读')+'</button>';
  const missing=board.elements.filter(e=>['line','arrow'].includes(e.type)&&relationName(e,A.flows)==='关系待说明');
  if(missing.length)h+='<section class="reading-gaps"><h3>'+missing.length+' 条关系待说明</h3><p class="hint">点击回到画板，为传递内容、条件或选择关系补充名称。</p>'+missing.map(e=>'<button data-reading-part="'+esc(e.id)+'">'+esc(get(e.from)?partTitle(get(e.from),A.flows):'未连接部位')+' → '+esc(get(e.to)?partTitle(get(e.to),A.flows):'未连接部位')+'</button>').join('')+'</section>';
  const unmapped=board.elements.filter(e=>e.type!=='frame'&&e.type!=='pen'&&(!e.implementation?.code&&!e.anchors?.length&&!elementProgram(e,A.organs,A.flows).linked.some(link=>link.value.anchors?.length)));
  if(unmapped.length)h+='<details class="reading-gaps"><summary>'+unmapped.length+' 个部位尚未关联实现依据</summary>'+unmapped.map(e=>readingPartButton(e,'data-reading-map-part')).join('')+'</details>';
  h+='<details class="reading-index"><summary>全部部位 · 包括未纳入主线的内容</summary><div class="reading-part-index">'+board.elements.map(e=>readingPartButton(e)).join('')+'</div></details>';content.innerHTML=h
}
function openReading(){if(!readingNavigationAllowed())return false;flushField();setTool('select');if(readingDraft!==undefined)editReading=true;renderReading();const dialog=$('reading-dialog');if(dialog&&!dialog.open)dialog.showModal();return true}
function beginReadingEdit(){
  if(readingDraft===undefined){const route=currentRoute();readingDraft=board.reading?structuredClone(board.reading):{summary:route.summary||'',steps:structuredClone(route.steps)};readingDraftBase=JSON.stringify(board.reading);readingDraftError=''}
  editReading=true;persistReadingDraft();renderReading()
}
function cancelReadingEdit(){readingDraft=undefined;readingDraftBase=undefined;readingDraftError='';editReading=false;clearReadingDraftStorage();renderReading()}
function failReadingEdit(text){readingDraftError=text;persistReadingDraft();const output=$('reading-error');if(output)output.textContent=text;return false}
function confirmReadingEdit(){
  if(!editReading||!readingDraft)return false;
  if(typeof canvasDraftChanged==='function'&&canvasDraftChanged())return failReadingEdit('请先确认或取消画板上的编辑，再确认导读修改。');
  if(JSON.stringify(board.reading)!==readingDraftBase)return failReadingEdit('原导读已变化。当前编辑内容已保留，请取消后重新打开导读，核对最新内容。');
  const candidate=structuredClone(board);candidate.reading=structuredClone(readingDraft);
  const errors=boardDiagnostics(candidate,A.organs,A.flows);
  if(errors.length)return failReadingEdit(errors.map(e=>e.message).join('；'));
  const nextReading=structuredClone(candidate.reading);readingDraft=undefined;readingDraftBase=undefined;readingDraftError='';editReading=false;
  clearReadingDraftStorage();
  change(()=>{board.reading=nextReading;routeId=nextReading.steps.length?'authored':null;readingIndex=-1});return true
}
function currentReadingElement(){return readingActive()?get(currentRoute().steps[readingIndex].element):null}
function readingOpenPart(id,editor){
  if(!get(id)||!readingNavigationAllowed())return false;if($('reading-dialog')?.open)$('reading-dialog').close();focusPart(id);
  if(editor==='program')openProgram(id);else if(editor==='human')openTextEditor(id)
}
$('open-reading')?.addEventListener('click',openReading);
$('reading-close')?.addEventListener('click',()=>{$('reading-dialog').close()});
$('reading-dialog')?.addEventListener('close',()=>{editReading=false;if(readingDraft!==undefined){persistReadingDraft();if(readingDraftChanged()&&typeof message==='function')message('导读编辑草稿已保留，打开工程导读可继续修改。')}});
$('reading-prev')?.addEventListener('click',()=>goReadingStep(readingIndex-1));
$('reading-next')?.addEventListener('click',()=>goReadingStep(readingIndex+1));
$('reading-outline')?.addEventListener('click',openReading);
$('reading-stop')?.addEventListener('click',()=>{readingIndex=-1;renderReading();renderScene()});
$('reading-map')?.addEventListener('click',()=>{const e=currentReadingElement();if(e)readingOpenPart(e.id,'program')});
$('reading-describe')?.addEventListener('click',()=>{const e=currentReadingElement();if(e)readingOpenPart(e.id,'human')});
$('reading-content')?.addEventListener('click',ev=>{
  const step=ev.target.closest('[data-reading-step]');if(step){goReadingStep(Number(step.dataset.readingStep));return}
  const part=ev.target.closest('[data-reading-part]'),mapPart=ev.target.closest('[data-reading-map-part]');
  if(part){readingOpenPart(part.dataset.readingPart);return}if(mapPart){readingOpenPart(mapPart.dataset.readingMapPart,'program');return}
  const move=ev.target.closest('[data-guide-move]'),remove=ev.target.closest('[data-guide-remove]');
  if(move&&editReading&&readingDraft){const index=Number(move.dataset.guideMove),to=index+Number(move.dataset.guideDirection),steps=readingDraft.steps;if(Number.isInteger(index)&&Number.isInteger(to)&&index>=0&&to>=0&&index<steps.length&&to<steps.length){[steps[index],steps[to]]=[steps[to],steps[index]];readingDraftError='';persistReadingDraft();renderReading()}return}
  if(remove&&editReading&&readingDraft){const index=Number(remove.dataset.guideRemove);if(Number.isInteger(index)&&index>=0&&index<readingDraft.steps.length){readingDraft.steps.splice(index,1);readingDraftError='';persistReadingDraft();renderReading()}return}
  const action=ev.target.closest('[data-guide-action]')?.dataset.guideAction;
  if(action==='edit')beginReadingEdit();if(action==='cancel')cancelReadingEdit();if(action==='confirm')confirmReadingEdit();
  if(action==='append'&&editReading&&readingDraft){const e=get($('reading-append-element')?.value);if(e){readingDraft.steps.push({element:e.id,title:partTitle(e,A.flows),description:''});readingDraftError='';persistReadingDraft();renderReading()}}
});
$('reading-content')?.addEventListener('input',ev=>{
  const path=ev.target.dataset.guideField;if(!editReading||!readingDraft||!path)return;
  if(path==='summary')readingDraft.summary=ev.target.value;
  else{const match=path.match(/^steps\.(\d+)\.(title|description)$/),step=match&&readingDraft.steps[Number(match[1])];if(step)step[match[2]]=ev.target.value}
  readingDraftError='';persistReadingDraft();if($('reading-error'))$('reading-error').textContent=''
});
$('reading-content')?.addEventListener('change',ev=>{if(ev.target.id==='reading-route'){routeId=ev.target.value;readingIndex=-1;renderReading();renderScene()}});
try{
  const stored=typeof localStorage!=='undefined'?JSON.parse(localStorage.getItem(key+':reading-editor')||'null'):null;
  if(stored?.version===1&&stored.reading&&typeof stored.reading==='object'&&!Array.isArray(stored.reading)&&Array.isArray(stored.reading.steps)&&stored.reading.steps.every(step=>step&&typeof step==='object'&&typeof step.element==='string')&&(stored.base===null||typeof stored.base==='string')){
    readingDraft=stored.reading;readingDraftBase=stored.base===null?undefined:stored.base;readingDraftError=typeof stored.error==='string'?stored.error:'';editReading=true;renderReading();readingEditorStatus();if(readingDraftChanged()&&typeof message==='function')message('已恢复未确认的导读草稿，打开工程导读可继续校对。')
  }
}catch{if(typeof message==='function')message('导读草稿暂时无法读取，原缓存已保留。')}
