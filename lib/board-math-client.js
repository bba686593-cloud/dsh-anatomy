// Formula editor and local handwriting recognition. Changes enter the board only after review.
function mathHTML(value){return formulaMarkup(value,katex).html}
let formulaTarget=null,formulaCategory=0,formulaOriginal=null;
function openFormulaLibrary(options={}){
  if(canvasDraftPending()){message('请先确认或取消当前编辑。');return}
  flushField();formulaTarget=selected.size===1?chosen()?.id||null:null;const e=get(formulaTarget),entries=elementMathEntries(e);
  $('formula-operation').innerHTML=(e?'<option value="append">追加到选中部位</option>':'')+(entries.length?'<option value="edit">编辑已有表达</option>':'')+'<option value="new">新建独立公式</option>';
  $('formula-expression').innerHTML=entries.map((f,i)=>'<option value="'+esc(f.id)+'">表达 '+(i+1)+' · '+esc(f.value.slice(0,50))+'</option>').join('');
  $('formula-operation').value=options.mode==='new'?'new':options.mode==='edit'&&entries.length?'edit':e?'append':'new';
  $('formula-expression').value=entries.some(f=>f.id===options.expression)?options.expression:entries[0]?.id||'';
  setFormulaOperation(true);renderFormulaLibrary();$('formula-dialog').showModal();previewFormula()
}
function setFormulaOperation(reset=false){
  const mode=$('formula-operation').value,e=get(formulaTarget),entry=elementMathEntries(e).find(f=>f.id===$('formula-expression').value);
  $('formula-expression-field').hidden=mode!=='edit';$('formula-expression').disabled=mode!=='edit';
  if(reset){$('formula-input').value=mode==='edit'?entry?.value||'':'';formulaOriginal=mode==='edit'?entry?.value:null}
  $('formula-destination').textContent=mode==='append'?'新增一条数学表达，原有表达和程序映射保留。':mode==='edit'?'只修改下方选定的表达，其他表达和程序映射保留。':'在画板中央新增独立公式图元。';
  $('formula-apply').textContent=mode==='append'?'确认追加表达':mode==='edit'?'确认修改表达':'确认新建公式';previewFormula()
}
function renderFormulaLibrary(){
  $('formula-categories').innerHTML=FORMULA_GROUPS.map(([name],i)=>'<button data-category="'+i+'" aria-pressed="'+(i===formulaCategory)+'">'+esc(name)+'</button>').join('');
  $('formula-templates').innerHTML=FORMULA_GROUPS[formulaCategory][1].map(([name,value],i)=>'<button class="formula-card" data-template="'+i+'"><span>'+esc(name)+'</span><div>'+mathHTML(value)+'</div></button>').join('');
  $('formula-symbols').innerHTML=MATH_SYMBOL_GROUPS.map(([name,symbols])=>'<div class="symbol-group"><small>'+esc(name)+'</small>'+symbols.split(' ').map(value=>'<button data-symbol="'+esc(value)+'">'+esc(value)+'</button>').join('')+'</div>').join('')
}
function previewFormula(){const result=formulaMarkup($('formula-input').value,katex);$('formula-preview').innerHTML=result.html;$('formula-feedback').textContent=result.error||'预览会随输入更新；变量含义可以写在图元的自然语言说明里。';$('formula-apply').disabled=!!result.error||!$('formula-input').value.trim()}
function insertAtCursor(input,value){const a=input.selectionStart??input.value.length,b=input.selectionEnd??a;input.value=input.value.slice(0,a)+value+input.value.slice(b);input.focus();input.setSelectionRange?.(a+value.length,a+value.length)}
function newAtCenter(type){const r=surface.getBoundingClientRect();const e=makeElement(type,(r.width/2-view.x)/view.scale-220,(r.height/2-view.y)/view.scale-100,440,200);e.text='';e.math='';return e}
function writeMathExpression(e,mode,value,id){
  if(mode==='edit'){if(id==='primary'){if(e.math!==value&&e.mathDisplay==='ink')e.mathDisplay='typeset';e.math=value;return {id:'primary'}}const entry=e.mathExpressions?.find(f=>f.id===id);if(!entry)return null;if(entry.value!==value&&entry.display==='ink')entry.display='typeset';entry.value=value;return entry}
  if(!e.math?.trim()){e.math=value;return {id:'primary'}}
  const entry={id:uid(),value};(e.mathExpressions??=[]).push(entry);return entry
}
function commitExpression(candidate,isNew){
  const next=structuredClone(board);if(isNew)next.elements.push(candidate);else next.elements[next.elements.findIndex(e=>e.id===candidate.id)]=candidate;
  const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length)return errors[0].message;
  change(()=>{board=next;manualDrawing();selected=new Set([candidate.id])});return null
}
function applyFormula(){
  const value=$('formula-input').value.trim(),mode=$('formula-operation').value,id=$('formula-expression').value;
  if(!value||programTrace(value)||formulaMarkup(value,katex).error){$('formula-feedback').textContent='请先修正数学表达。';return}
  const target=get(formulaTarget);if(mode!=='new'&&!target){$('formula-feedback').textContent='原部位已变化，请重新选择部位。';return}
  if(mode==='edit'&&elementMathEntries(target).find(f=>f.id===id)?.value!==formulaOriginal){$('formula-feedback').textContent='原表达已变化，请重新打开编辑器后核对。';return}
  const candidate=mode==='new'?newAtCenter('math'):structuredClone(target);if(!writeMathExpression(candidate,mode==='new'?'append':mode,value,id))return;
  const error=commitExpression(candidate,mode==='new');if(error){$('formula-feedback').textContent=error;return}
  $('formula-dialog').close();tab='human';select(candidate.id);message(mode==='edit'?'已修改选定表达，可撤销。':'已新增数学表达，原有表达保留，可撤销。')
}
$('open-formulas').addEventListener('click',openFormulaLibrary);$('formula-close').addEventListener('click',()=>$('formula-dialog').close());$('formula-input').addEventListener('input',previewFormula);$('formula-apply').addEventListener('click',applyFormula);
$('formula-operation').addEventListener('change',()=>setFormulaOperation(true));$('formula-expression').addEventListener('change',()=>setFormulaOperation(true));
$('formula-categories').addEventListener('click',ev=>{const t=ev.target.closest('[data-category]');if(t){formulaCategory=Number(t.dataset.category);renderFormulaLibrary()}});
$('formula-templates').addEventListener('click',ev=>{const t=ev.target.closest('[data-template]');if(t){insertAtCursor($('formula-input'),FORMULA_GROUPS[formulaCategory][1][Number(t.dataset.template)][1]);previewFormula()}});
$('formula-symbols').addEventListener('click',ev=>{const t=ev.target.closest('[data-symbol]');if(t){insertAtCursor($('formula-input'),t.dataset.symbol);previewFormula()}});
let inkStrokes=[],inkActive=null,inkMode='text',inkTarget=null,inkRevision=0,inkRequest=null,inkSequence=0,inkSourceIds=[],inkRecognition=null,inkOriginal=null;
const inkPad=$('ink-pad'),inkDraftKey=key+':handwriting';
let inkSourceBaseline=null;let inkServiceTimer=null,inkServiceSequence=0,inkPaperSession=null;
function inkDraftSnapshot(){return JSON.stringify({mode:inkMode,strokes:inkStrokes,result:$('ink-result').value||'',candidate:inkRecognition})}
function saveInkDraft(){if(inkPaperSession?.inkBefore!==undefined&&canvasDraft?.kind==='paper'&&canvasDraft.target===inkPaperSession.target){canvasDraft.hasInkDraft=inkDraftSnapshot()!==inkPaperSession.inkBefore&&!!(inkStrokes.length||$('ink-result').value?.trim());canvasDraft.focusExpression=inkPaperSession.expression;persistCanvasDraft()}try{if(!inkStrokes.length&&!$('ink-result').value?.trim()){localStorage.removeItem(inkDraftKey);return}localStorage.setItem(inkDraftKey,JSON.stringify({mode:inkMode,strokes:inkStrokes,result:$('ink-result').value||'',candidate:inkRecognition,sourceElements:inkSourceIds,target:inkTarget,destination:$('ink-destination').value||'new',original:inkOriginal,paperSession:inkPaperSession}))}catch{$('ink-feedback').textContent='浏览器无法暂存笔迹，请先完成识别和确认再关闭。'}}
function loadInkDraft(){try{const draft=JSON.parse(localStorage.getItem(inkDraftKey)||'null');return storedInk({handwriting:draft})}catch{return null}}
function inkChanged(){inkRecognition=null;inkRevision++;inkRequest?.abort();inkRequest=null;$('ink-recognize').disabled=false;$('ink-result').value='';$('ink-result-preview').innerHTML='';$('ink-result-error').textContent='';$('ink-apply').disabled=true;$('ink-feedback').textContent='写好后点击「识别笔迹」。识别结果可校对，原笔迹会保留。';renderInk();saveInkDraft()}
function renderInk(){ $('ink-paths').innerHTML=inkStrokes.map(s=>s.length===1?'<circle cx="'+s[0][0]+'" cy="'+s[0][1]+'" r="2.5" fill="#18233b"/>':'<polyline points="'+s.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#18233b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>').join('');$('ink-undo').disabled=!inkStrokes.length;$('ink-empty').style.display=inkStrokes.length?'none':'block' }
function penToStroke(e){const rad=(e.rotation||0)*Math.PI/180,cx=e.x+e.width/2,cy=e.y+e.height/2;return e.points.map(([x,y])=>{x=e.x+x*e.width-cx;y=e.y+y*e.height-cy;return[cx+x*Math.cos(rad)-y*Math.sin(rad),cy+x*Math.sin(rad)+y*Math.cos(rad)]})}
function fitStrokes(strokes){const all=strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(1,Math.max(...xs)-x),h=Math.max(1,Math.max(...ys)-y),scale=Math.min(900/w,320/h);return strokes.map(s=>s.map(p=>[50+(p[0]-x)*scale,50+(p[1]-y)*scale]))}
function storedInk(element){const h=element?.handwriting,s=h?.strokes;return h&&['text','math'].includes(h.mode)&&Array.isArray(s)&&s.length<=200&&s.every(stroke=>Array.isArray(stroke)&&stroke.length>0&&stroke.length<=1500&&stroke.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=1000&&p[1]>=0&&p[1]<=420))&&s.reduce((n,stroke)=>n+stroke.length,0)<=20000?h:null}
function primaryMathInk(e){const separate=storedInk({handwriting:e?.mathHandwriting});return separate?.mode==='math'?separate:storedInk(e)?.mode==='math'?e.handwriting:null}
function inkExpression(e,id){if(!e)return null;if(id==='primary')return{id,value:e.math||'',handwriting:primaryMathInk(e)};return e.mathExpressions?.find(f=>f.id===id)||null}
function inkBaseline(e){return e?{target:e.id,math:[{id:'primary',value:e.math||''},...(e.mathExpressions||[]).map(f=>({id:f.id,value:f.value}))],text:e.text||''}:null}
function storedInkBaseline(value,target){return value?.target===target&&Array.isArray(value.math)&&value.math.every(f=>f&&typeof f.id==='string'&&typeof f.value==='string')&&typeof value.text==='string'?structuredClone(value):null}
function inkDestinations(preferred=null){
  $('ink-destination').hidden=!!inkPaperSession;if(inkPaperSession){$('ink-destination').innerHTML='<option value="paper">放入当前文稿</option>';$('ink-destination').value='paper';$('ink-apply').textContent='放入文稿';return}$('ink-apply').textContent='确认放入画板';
  const e=get(inkTarget),entries=elementMathEntries(e),options=[...(inkMode==='math'&&inkSourceIds.length?[['replace-ink','在原笔迹位置排版（保留原稿）']]:[]),['new','新增独立文字或公式']];
  if(e){if(inkMode==='math'){options.push(['append','追加数学表达到选中部位']);for(const [i,f]of entries.entries())options.push(['edit:'+f.id,'编辑表达 '+(i+1)+' · '+f.value.slice(0,35)])}else options.push(['selected','修改选中部位的中文说明'])}
  if(preferred==='selected'&&inkMode==='math')preferred='edit:primary';
  $('ink-destination').innerHTML=options.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('');
  $('ink-destination').value=options.some(([v])=>v===preferred)?preferred:inkMode==='math'&&inkSourceIds.length?'replace-ink':e&&inkMode==='math'?'append':'new'
}
function openHandwriting(options={}){if(inlineWritingOpen()&&!options.paper)options={paper:true,expression:paperActiveExpression};
  inkPaperSession=options.paper&&canvasDraft?.kind==='paper'?{target:canvasDraft.target,before:JSON.stringify(canvasDraft.value),expression:options.expression||null}:null;
  if(canvasDraftPending()&&!inkPaperSession){message('请先确认或取消当前编辑。');return}
  flushField();const pens=board.elements.filter(e=>selected.has(e.id)&&e.type==='pen');
  if(pens.reduce((n,e)=>n+e.points.length,0)>20000){message('选中的笔迹太多，请分批识别。');return}
  inkSourceIds=pens.map(e=>e.id);inkSourceBaseline=JSON.stringify(pens);inkTarget=selected.size===1&&chosen()?.type!=='pen'?chosen()?.id||null:null;
  const expressionId=typeof options?.expression==='string'?options.expression:null,expression=expressionId?inkExpression(inkPaperSession?canvasDraft.value:get(inkTarget),expressionId):null;
  if(expressionId&&!expression){message('原表达已变化，请重新选择要编辑的表达。');return}
  const previous=loadInkDraft(),saved=pens.length?null:expressionId?storedInk(expression):inkPaperSession?null:storedInk(chosen())||primaryMathInk(chosen());
  const matchesPaper=inkPaperSession&&previous?.paperSession?.target===inkPaperSession.target&&previous.paperSession.before===inkPaperSession.before&&previous.paperSession.expression===inkPaperSession.expression;
  const draft=inkPaperSession?(matchesPaper?previous:null):!previous?.paperSession&&!pens.length&&(!expressionId||(previous?.mode==='math'&&previous?.target===inkTarget&&previous?.destination==='edit:'+expressionId))&&(!saved||previous?.target===inkTarget)?previous:null;
  inkStrokes=pens.length?fitStrokes(pens.map(penToStroke)):draft?structuredClone(draft.strokes):saved?structuredClone(saved.strokes):[];
  const restored=draft||saved;if(restored){inkMode=restored.mode;inkSourceIds=Array.isArray(restored.sourceElements)?restored.sourceElements.filter(id=>typeof id==='string'):[]}
  if(expressionId||options.mode==='math'||pens.length)inkMode='math';else if(inkPaperSession&&!draft)inkMode='text';
  if(draft&&!inkPaperSession)inkTarget=get(draft.target)?.id||null;inkOriginal=storedInkBaseline(draft?.original,inkTarget)||inkBaseline(get(inkTarget));inkActive=null;inkChanged();$('ink-dialog').showModal();setInkMode(inkMode);
  if(expressionId&&!draft){inkDestinations('edit:'+expressionId);$('ink-result').value=expression.value;inkRecognition=saved?.candidate?structuredClone(saved.candidate):null;previewInkResult()}
  else if(saved){inkDestinations(inkMode==='math'?'edit:primary':'selected');$('ink-result').value=get(inkTarget)?.[inkMode==='math'?'math':'text']||'';inkRecognition=saved.candidate?structuredClone(saved.candidate):null;previewInkResult()}
  if(draft){inkDestinations(draft.destination);$('ink-result').value=typeof draft.result==='string'?draft.result:'';inkRecognition=draft.candidate||null;previewInkResult();$('ink-feedback').textContent='已恢复上次未确认的笔迹，可继续识别或校对。'}
  if(inkPaperSession)inkPaperSession.inkBefore=typeof draft?.paperSession?.inkBefore==='string'?draft.paperSession.inkBefore:inkDraftSnapshot();
  $('ink-keep').hidden=!!inkPaperSession;saveInkDraft();checkInkService()
}
function setInkMode(mode){inkMode=mode;inkChanged();inkDestinations();$('ink-mode-text').setAttribute('aria-pressed',String(mode==='text'));$('ink-mode-math').setAttribute('aria-pressed',String(mode==='math'));$('ink-instructions').textContent=mode==='text'?'用鼠标、触控笔或手指写中文说明，建议每次写一行。':inkPaperSession?'在这里写一条公式。校对后放入文稿，完成编辑前可以继续修改。':'在区域内写一条数学公式，支持分式、根式、上下标等结构。追加会保留原有表达；编辑时请选择具体的一条。';}
function inkPoint(ev){const r=inkPad.getBoundingClientRect();return[Math.max(0,Math.min(1000,(ev.clientX-r.left)*1000/r.width)),Math.max(0,Math.min(420,(ev.clientY-r.top)*420/r.height))]}
inkPad.addEventListener('pointerdown',ev=>{if(ev.button!==0||inkActive)return;ev.preventDefault();if(inkStrokes.length>=200){$('ink-feedback').textContent='本次笔画较多，请分段识别。';return}inkActive={pointer:ev.pointerId,stroke:[inkPoint(ev)]};inkStrokes.push(inkActive.stroke);inkPad.setPointerCapture(ev.pointerId);inkChanged()});
inkPad.addEventListener('pointermove',ev=>{if(!inkActive||inkActive.pointer!==ev.pointerId)return;const p=inkPoint(ev),last=inkActive.stroke.at(-1);if(inkActive.stroke.length<1500&&inkStrokes.reduce((n,s)=>n+s.length,0)<20000&&Math.hypot(p[0]-last[0],p[1]-last[1])>.8)inkActive.stroke.push(p);renderInk()});
inkPad.addEventListener('pointerup',ev=>{if(inkActive?.pointer===ev.pointerId){inkActive=null;inkRevision++;saveInkDraft()}});
inkPad.addEventListener('pointercancel',ev=>{if(inkActive?.pointer===ev.pointerId){inkStrokes.pop();inkActive=null;inkChanged()}});
function inkImage(){const all=inkStrokes.flat();if(!all.length)throw Error('先写一些内容再识别。');const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),left=Math.max(0,Math.min(...xs)-24),top=Math.max(0,Math.min(...ys)-24),right=Math.min(1000,Math.max(...xs)+24),bottom=Math.min(420,Math.max(...ys)+24),canvas=document.createElement('canvas');canvas.width=Math.max(64,Math.ceil((right-left)*1.6));canvas.height=Math.max(64,Math.ceil((bottom-top)*1.6));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(1.6,1.6);ctx.translate(-left,-top);ctx.strokeStyle='black';ctx.fillStyle='black';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';for(const s of inkStrokes){ctx.beginPath();ctx.moveTo(...s[0]);for(const p of s.slice(1))ctx.lineTo(...p);if(s.length===1){ctx.arc(...s[0],2,0,Math.PI*2);ctx.fill()}else ctx.stroke()}return canvas.toDataURL('image/png')}
function inkConnectionError(error){return error.name==='AbortError'?'连接超时，正在等待本地识别服务。':error.name==='TypeError'?'未能连接本地识别服务。':error.message||'本地识别服务暂不可用。'}
async function checkInkService(){
  const seq=++inkServiceSequence;clearTimeout(inkServiceTimer);$('ink-reconnect').disabled=true;
  let timeout,controller;
  try{
    controller=new AbortController();timeout=setTimeout(()=>controller.abort(),6000);
    const r=await fetch('/api/health',{signal:controller.signal,cache:'no-store'});
    if(!r.ok)throw Error(r.status===404?'当前地址没有手写识别接口。':'连接检测失败（'+r.status+'）。');
    let v;try{v=await r.json()}catch{throw Error('当前地址提供的是静态页面，没有手写识别接口。')}
    if(v.service!=='anatomy-handwriting')throw Error('当前地址没有连接手写识别服务。');
    if(seq!==inkServiceSequence)return;
    $('ink-service').textContent=v.error?'识别模型未就绪：'+v.error:v.ready?'本地中文与公式识别已就绪。':v.modes?.includes(inkMode)?'当前识别模式已就绪。':'服务已连接，模型正在准备，请稍候。';
  }catch(error){if(seq===inkServiceSequence)$('ink-service').textContent=inkConnectionError(error)+' 笔迹仍保留在面板中，可点击「重新连接」。'}
  finally{clearTimeout(timeout);if(seq===inkServiceSequence){$('ink-reconnect').disabled=false;if($('ink-dialog').open)inkServiceTimer=setTimeout(checkInkService,5000)}}
}
async function recognizeInk(){let image;try{image=inkImage()}catch(e){$('ink-feedback').textContent=e.message;return}const revision=inkRevision,seq=++inkSequence,mode=inkMode;inkRequest?.abort();let controller,timeout;$('ink-recognize').disabled=true;$('ink-feedback').textContent='正在本机识别，首次加载模型可能需要较长时间…';saveInkDraft();try{controller=new AbortController();inkRequest=controller;timeout=setTimeout(()=>controller.abort(),180000);const response=await fetch('/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,image}),signal:controller.signal});let data;try{data=await response.json()}catch{throw Error('当前页面没有识别服务，请从本地手写服务打开画板。')}if(!response.ok||!data.ok)throw Error(data.error||'识别失败，请重试。');if(revision!==inkRevision||seq!==inkSequence)return;checkInkService();inkRecognition={text:data.text||'',engine:data.engine||null,...(Array.isArray(data.scores)?{scores:data.scores}:{} )};$('ink-result').value=data.text||'';previewInkResult();saveInkDraft();$('ink-feedback').textContent=data.text?'识别完成，请核对中文、符号、上下标和分式，再确认放入画板。':'没有识别到内容，请写大一些并分开笔画后重试。'}catch(e){if(revision===inkRevision&&seq===inkSequence)$('ink-feedback').textContent=e.name==='AbortError'?'识别已停止或超时，笔迹已保留，可以重新识别。':e.name==='TypeError'?'识别请求未能连接到本地服务，笔迹已保留。点击「重新连接」后重试。':e.message}finally{clearTimeout(timeout);if(seq===inkSequence){inkRequest=null;$('ink-recognize').disabled=false}}}
function previewInkResult(){const value=$('ink-result').value,parsed=inkMode==='math'?formulaMarkup(value,katex):{html:esc(value),error:null};$('ink-result-preview').innerHTML=parsed.html;const error=programTrace(value)?'识别结果包含程序表达，请先改为自然语言或数学表达。':parsed.error;$('ink-result-error').textContent=error||'';$('ink-apply').disabled=!value.trim()||!!error}
function applyInkResult(){
  const value=$('ink-result').value.trim(),destination=$('ink-destination').value||'new';
  if(!value||programTrace(value)||(inkMode==='math'&&formulaMarkup(value,katex).error)){message('请先校对识别结果。');return}
  const handwriting={mode:inkMode,reviewed:true,candidate:inkRecognition?structuredClone(inkRecognition):null,sourceElements:inkSourceIds,strokes:structuredClone(inkStrokes),reviewedValue:value};
  if(inkPaperSession){const error=paperInk(value,handwriting,inkPaperSession);if(error){$('ink-feedback').textContent=error;return}closeInk(true);message('已放入文稿，可继续编辑或撤销。');return}
  if(destination==='replace-ink'){applyRecognizedDrawing(value,handwriting);return}
  const isNew=destination==='new',target=get(inkTarget);
  if(!isNew&&!target){$('ink-feedback').textContent='原部位已变化，请重新选择部位。';return}
  const candidate=isNew?newAtCenter(inkMode==='math'?'math':'text'):structuredClone(target);
  if(inkMode==='math'){
    const editing=destination.startsWith('edit:')||destination==='selected',id=destination==='selected'?'primary':destination.slice(5);
    if(editing){const original=inkOriginal?.target===inkTarget?inkOriginal.math.find(f=>f.id===id):null,current=inkExpression(target,id);if(!original||!current||current.value!==original.value){$('ink-feedback').textContent='原表达已变化，请重新打开手写编辑器后核对。';return}}
    const expression=writeMathExpression(candidate,editing?'edit':'append',value,id);
    if(!expression){$('ink-feedback').textContent='原表达已变化，请重新选择要编辑的表达。';return}
    if(expression.id==='primary'){candidate.mathDisplay='typeset';if(candidate.handwriting?.mode==='text'||candidate.mathHandwriting!==undefined)candidate.mathHandwriting=handwriting;else candidate.handwriting=handwriting}else{expression.handwriting=handwriting;expression.display='typeset'}
  }else{if(!isNew&&(inkOriginal?.target!==inkTarget||(target.text||'')!==inkOriginal.text)){$('ink-feedback').textContent='原中文说明已变化，请重新打开手写编辑器后核对。';return}candidate.text=value;if(candidate.handwriting?.mode==='math'&&candidate.mathHandwriting===undefined)candidate.mathHandwriting=structuredClone(candidate.handwriting);candidate.handwriting=handwriting}
  const error=commitExpression(candidate,isNew);if(error){$('ink-feedback').textContent=error;return}
  closeInk(true);tab='human';select(candidate.id);message('已放入画板，原笔迹与程序映射均保留，可撤销。')
}
function closeInk(discard=false){if(discard===true){localStorage.removeItem(inkDraftKey);if(inkPaperSession&&canvasDraft?.kind==='paper'){canvasDraft.hasInkDraft=false;persistCanvasDraft()}}else saveInkDraft();inkRequest?.abort();inkRevision++;inkServiceSequence++;clearTimeout(inkServiceTimer);inkActive=null;$('ink-dialog').close();inkPaperSession=null}
$('open-handwriting').addEventListener('click',openHandwriting);$('ink-close').addEventListener('click',closeInk);$('ink-dialog').addEventListener('cancel',closeInk);$('ink-mode-text').addEventListener('click',()=>setInkMode('text'));$('ink-mode-math').addEventListener('click',()=>setInkMode('math'));$('ink-undo').addEventListener('click',()=>{inkStrokes.pop();inkChanged()});$('ink-clear').addEventListener('click',()=>{inkStrokes=[];inkChanged()});$('ink-recognize').addEventListener('click',recognizeInk);$('ink-result').addEventListener('input',()=>{previewInkResult();saveInkDraft()});$('ink-reconnect').addEventListener('click',checkInkService);$('ink-destination').addEventListener('change',saveInkDraft);window.addEventListener('beforeunload',()=>{if($('ink-dialog').open)saveInkDraft()});$('ink-apply').addEventListener('click',applyInkResult);$('ink-keep').addEventListener('click',keepDrawingInk);
window.__anatomyBoard.math={openFormulaLibrary,applyFormula,openHandwriting,applyInkResult,checkInkService,get strokes(){return inkStrokes},get mode(){return inkMode}};
