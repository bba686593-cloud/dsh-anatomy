// Formula graphics and local recognition. Source notation is never an editing UI.
function mathHTML(value){return formulaMarkup(value,katex).html}
let formulaTarget=null,formulaCategory=0,formulaOriginal=null,pickedLibraryMath='',formulaBusy=false,formulaAt=null,formulaRevision=0;
function hideMathSource(node){if(!node)return;node.hidden=true;const label=node.closest?.('label')||node.parentElement;if(label?.tagName==='LABEL')label.hidden=true}
function openFormulaLibrary(options={}){
  if(canvasDraftPending()){message('请先确认或取消当前编辑。');return}
  flushField();formulaRevision++;formulaTarget=selected.size===1?chosen()?.id||null:null;formulaAt=options.at?structuredClone(options.at):null;
  pickedLibraryMath=typeof options.value==='string'?options.value:pickedLibraryMath||FORMULA_GROUPS[formulaCategory][1][0][1];
  setFormulaOperation();renderFormulaLibrary();$('formula-dialog').showModal();previewFormula()
}
function setFormulaOperation(){
  $('formula-operation').value='new';for(const id of ['formula-input','formula-operation','formula-expression','formula-symbols','formula-expression-field'])hideMathSource($(id));
  const label=document.querySelector?.('label[for="formula-input"]');if(label)label.hidden=true;
  $('formula-destination').textContent='选择公式图形，复制或放到画板后直接擦除、补画。';$('formula-apply').textContent='放到画板';previewFormula()
}
function renderFormulaLibrary(){
  $('formula-categories').innerHTML=FORMULA_GROUPS.map(([name],i)=>'<button data-category="'+i+'" aria-pressed="'+(i===formulaCategory)+'">'+esc(name)+'</button>').join('');
  const search=($('formula-search')?.value||'').trim();
  $('formula-templates').innerHTML=FORMULA_GROUPS[formulaCategory][1].map(([name,value],i)=>!search||name.includes(search)||FORMULA_GROUPS[formulaCategory][0].includes(search)?'<button class="formula-card" data-template="'+i+'" aria-pressed="'+(value===pickedLibraryMath)+'"><span>'+esc(name)+'</span><div>'+mathHTML(value)+'</div></button>':'').join('');
  $('formula-symbols').hidden=true
}
function selectFormulaTemplate(value){formulaRevision++;pickedLibraryMath=String(value||'');$('formula-input').value=pickedLibraryMath;previewFormula();renderFormulaLibrary();return !formulaMarkup(pickedLibraryMath,katex).error}
function previewFormula(keepFeedback=false){const value=pickedLibraryMath,result=formulaMarkup(value,katex);$('formula-input').value=value;$('formula-input').hidden=true;$('formula-preview').innerHTML=result.error?'<p>暂不能生成这个公式图形，请重新选择模板。</p>':result.html;if(!keepFeedback)$('formula-feedback').textContent=result.error?'暂不能生成这个公式图形。':'预览是可复制的公式图形；放到画板后可以圈选、擦除和补画。';$('formula-apply').disabled=formulaBusy||!!result.error||!value.trim();if($('formula-copy'))$('formula-copy').disabled=$('formula-apply').disabled}
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
async function applyFormula(){
  const value=($('formula-input').value||pickedLibraryMath).trim();
  if(!value||programTrace(value)||formulaMarkup(value,katex).error){$('formula-feedback').textContent='请先修正数学表达。';return}
  if(formulaBusy||canvasDraftPending())return false;pickedLibraryMath=value;formulaBusy=true;previewFormula();
  const revision=formulaRevision,at=formulaAt?structuredClone(formulaAt):null,guard=()=>$('formula-dialog').open&&formulaRevision===revision&&pickedLibraryMath===value&&($('formula-input').value||pickedLibraryMath).trim()===value;
  try{const element=await insertFormulaGraphic(value,{at,guard});if(!element)return false;$('formula-dialog').close();tab='human';if(element.id)select(element.id);message('公式图形已放到画板，可以擦除、补画和复制。');return element}
  catch{if(guard())$('formula-feedback').textContent='未能生成公式图形，请重新选择或重试。';return false}
  finally{formulaBusy=false;previewFormula(true)}
}
async function copyLibraryFormula(){if(formulaBusy||!pickedLibraryMath||formulaMarkup(pickedLibraryMath,katex).error)return false;formulaBusy=true;previewFormula();try{const result=await copyFormulaGraphic(pickedLibraryMath);$('formula-feedback').textContent=result===false?'未能复制，请重试或先放到画板。':'公式图形已复制，可粘贴到画板。';return result}catch{$('formula-feedback').textContent='未能复制，请重试或先放到画板。';return false}finally{formulaBusy=false;previewFormula(true)}}
$('open-formulas').addEventListener('click',openFormulaLibrary);$('formula-close').addEventListener('click',()=>{formulaRevision++;$('formula-dialog').close()});$('formula-dialog').addEventListener('cancel',()=>{formulaRevision++});$('formula-dialog').addEventListener('close',()=>{formulaRevision++});$('formula-input').addEventListener('input',()=>selectFormulaTemplate($('formula-input').value));$('formula-apply').addEventListener('click',applyFormula);
$('formula-operation').addEventListener('change',()=>setFormulaOperation(true));$('formula-expression').addEventListener('change',()=>setFormulaOperation(true));
$('formula-categories').addEventListener('click',ev=>{const t=ev.target.closest('[data-category]');if(t){formulaCategory=Number(t.dataset.category);renderFormulaLibrary()}});
$('formula-templates').addEventListener('click',ev=>{const t=ev.target.closest('[data-template]');if(t){const entry=FORMULA_GROUPS[formulaCategory][1][Number(t.dataset.template)];if(entry)selectFormulaTemplate(entry[1])}});
$('formula-copy')?.addEventListener('click',copyLibraryFormula);$('formula-search')?.addEventListener('input',renderFormulaLibrary);
let inkStrokes=[],inkActive=null,inkMode='text',inkTarget=null,inkRevision=0,inkRequest=null,inkSequence=0,inkSourceIds=[],inkRecognition=null,inkOriginal=null;
const inkPad=$('ink-pad'),inkDraftKey=key+':handwriting';
let inkSourceBaseline=null;let inkServiceTimer=null,inkServiceSequence=0,inkPaperSession=null,inkLassoSession=null,lassoChoiceSession=null,lassoRequestedMode='math',inkApplying=false;
const inkPreferenceKey='anatomy-recognition:preferences';
let inkProvider='agent',inkEndpoint='',inkLocalConnection=null,inkAgentRequest=null,inkAgentAvailable=false,inkAgentMode=null;
try{const preference=JSON.parse(localStorage.getItem(inkPreferenceKey)||'null');if(preference?.provider==='local')inkProvider='local';if(typeof preference?.endpoint==='string')inkEndpoint=recognitionOrigin(preference.endpoint)}catch{}
function recognitionOrigin(value){
  const input=String(value||'').trim();if(!input)return '';
  let url;try{url=new URL(input)}catch{throw Error('请输入完整的本地服务地址，例如 http://127.0.0.1:8767。')}
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/i.test(input)||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('服务地址只能是 HTTP 本机地址，不能包含账号、密码、路径或参数。');
  return url.origin
}
function saveInkPreferences(){try{localStorage.setItem(inkPreferenceKey,JSON.stringify({provider:inkProvider,endpoint:inkEndpoint}))}catch{}}
function updateInkProviderControls(){
  $('ink-provider').value=inkProvider;$('ink-endpoint').value=inkEndpoint;$('ink-local-settings').hidden=inkProvider!=='local';$('ink-disconnect').disabled=!inkLocalConnection?.connected;$('ink-reconnect').textContent=inkProvider==='agent'?'检查智能体连接':'连接服务';
  $('ink-provider-hint').textContent=inkProvider==='agent'?inkAgentMode==='executor'?'使用已配置的独立智能体任务处理圈选图片，结果仍需确认；图片由该智能体的模型服务处理。':'由当前 DSH / Codex 会话接管圈选图像并返回候选，确认前不会修改画板。':'连接这台电脑上的插件识别服务；首次使用可按插件说明安装和预加载模型。'
}
function hideInkAgentRequest(){$('ink-agent-waiting').hidden=true;$('ink-agent-prompt').value='';$('ink-agent-id').textContent=''}
function sendInkAgentCancel(request){if(!request||request.cancelSent)return;request.cancelSent=true;fetch('/api/recognition/agent/'+encodeURIComponent(request.id)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'omit',keepalive:true}).catch(()=>{})}
function cancelInkRequest(){const request=inkAgentRequest;inkAgentRequest=null;inkRequest?.abort();inkRequest=null;inkSequence++;sendInkAgentCancel(request);hideInkAgentRequest()}
function setInkProvider(provider){inkProvider=provider==='local'?'local':'agent';inkLocalConnection=null;inkAgentAvailable=false;inkAgentMode=null;inkChanged();saveInkPreferences();updateInkProviderControls();checkInkService()}
function disconnectInkService(){cancelInkRequest();inkRevision++;inkLocalConnection=null;inkServiceSequence++;clearTimeout(inkServiceTimer);$('ink-service').textContent='本地服务已断开，笔迹与候选仍保留。';$('ink-reconnect').disabled=false;updateInkProviderControls();previewInkResult()}
updateInkProviderControls();hideInkAgentRequest();
function inkDraftSnapshot(){return JSON.stringify({mode:inkMode,strokes:inkStrokes,result:$('ink-result').value||'',candidate:inkRecognition})}
function saveInkDraft(){if(inkPaperSession?.inkBefore!==undefined&&canvasDraft?.kind==='paper'&&canvasDraft.target===inkPaperSession.target){canvasDraft.hasInkDraft=inkDraftSnapshot()!==inkPaperSession.inkBefore&&!!(inkStrokes.length||$('ink-result').value?.trim());canvasDraft.focusExpression=inkPaperSession.expression;persistCanvasDraft()}try{if(!inkStrokes.length&&!$('ink-result').value?.trim()){localStorage.removeItem(inkDraftKey);return}localStorage.setItem(inkDraftKey,JSON.stringify({mode:inkMode,strokes:inkStrokes,result:$('ink-result').value||'',candidate:inkRecognition,sourceElements:inkSourceIds,target:inkTarget,destination:$('ink-destination').value||'new',original:inkOriginal,paperSession:inkPaperSession,lassoSession:inkLassoSession}))}catch{$('ink-feedback').textContent='浏览器无法暂存笔迹，请先完成识别和确认再关闭。'}}
function loadInkDraft(){try{const draft=JSON.parse(localStorage.getItem(inkDraftKey)||'null');return storedInk({handwriting:draft})}catch{return null}}
function inkChanged(){inkRecognition=null;inkRevision++;cancelInkRequest();$('ink-recognize').disabled=false;$('ink-result').value='';$('ink-result-preview').innerHTML='';$('ink-result-error').textContent='';$('ink-apply').disabled=true;$('ink-feedback').textContent='写好后点击「识别笔迹」。识别结果可校对，原笔迹会保留。';renderInk();saveInkDraft()}
function renderInk(){ $('ink-paths').innerHTML=inkLassoSession?.image?'<image href="'+esc(inkLassoSession.image)+'" x="0" y="0" width="1000" height="420"/>':inkStrokes.map(s=>s.length===1?'<circle cx="'+s[0][0]+'" cy="'+s[0][1]+'" r="2.5" fill="#18233b"/>':'<polyline points="'+s.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#18233b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>').join('');$('ink-undo').disabled=!!inkLassoSession||!inkStrokes.length;$('ink-clear').disabled=!!inkLassoSession;$('ink-empty').style.display=inkLassoSession?.image||inkStrokes.length?'none':'block';if(inkLassoSession?.capturing)$('ink-empty').textContent='正在准备圈内图形预览…' }
function penToStroke(e){const rad=(e.rotation||0)*Math.PI/180,cx=e.x+e.width/2,cy=e.y+e.height/2;return e.points.map(([x,y])=>{x=e.x+x*e.width-cx;y=e.y+y*e.height-cy;return[cx+x*Math.cos(rad)-y*Math.sin(rad),cy+x*Math.sin(rad)+y*Math.cos(rad)]})}
function fitStrokes(strokes){const all=strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(1,Math.max(...xs)-x),h=Math.max(1,Math.max(...ys)-y),scale=Math.min(900/w,320/h);return strokes.map(s=>s.map(p=>[50+(p[0]-x)*scale,50+(p[1]-y)*scale]))}
function storedInk(element){const h=element?.handwriting,s=h?.strokes;return h&&['text','math'].includes(h.mode)&&Array.isArray(s)&&s.length<=200&&s.every(stroke=>Array.isArray(stroke)&&stroke.length>0&&stroke.length<=1500&&stroke.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=1000&&p[1]>=0&&p[1]<=420))&&s.reduce((n,stroke)=>n+stroke.length,0)<=20000?h:null}
function primaryMathInk(e){const separate=storedInk({handwriting:e?.mathHandwriting});return separate?.mode==='math'?separate:storedInk(e)?.mode==='math'?e.handwriting:null}
function inkExpression(e,id){if(!e)return null;if(id==='primary')return{id,value:e.math||'',handwriting:primaryMathInk(e)};return e.mathExpressions?.find(f=>f.id===id)||null}
function inkBaseline(e){return e?{target:e.id,math:[{id:'primary',value:e.math||''},...(e.mathExpressions||[]).map(f=>({id:f.id,value:f.value}))],text:e.text||''}:null}
function storedInkBaseline(value,target){return value?.target===target&&Array.isArray(value.math)&&value.math.every(f=>f&&typeof f.id==='string'&&typeof f.value==='string')&&typeof value.text==='string'?structuredClone(value):null}
function inkDestinations(preferred=null){
  if(inkLassoSession){$('ink-destination').hidden=true;$('ink-destination').innerHTML='<option value="replace-ink">放入圈选位置</option>';$('ink-destination').value='replace-ink';$('ink-apply').textContent=inkLassoSession.slices.some(s=>s.visual)?'确认新增到圈选位置':'确认放回圈选位置';return}
  $('ink-destination').hidden=!!inkPaperSession;if(inkPaperSession){$('ink-destination').innerHTML='<option value="paper">放入当前文稿</option>';$('ink-destination').value='paper';$('ink-apply').textContent='放入文稿';return}$('ink-apply').textContent='确认放入画板';
  const e=get(inkTarget),entries=elementMathEntries(e),options=[...(inkMode==='math'&&inkSourceIds.length?[['replace-ink','在原笔迹位置排版（保留原稿）']]:[]),['new','新增独立文字或公式']];
  if(e){if(inkMode==='math'){options.push(['append','追加数学表达到选中部位']);for(const [i,f]of entries.entries())options.push(['edit:'+f.id,'编辑表达 '+(i+1)+' · '+f.value.slice(0,35)])}else options.push(['selected','修改选中部位的中文说明'])}
  if(preferred==='selected'&&inkMode==='math')preferred='edit:primary';
  $('ink-destination').innerHTML=options.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('');
  $('ink-destination').value=options.some(([v])=>v===preferred)?preferred:inkMode==='math'&&inkSourceIds.length?'replace-ink':e&&inkMode==='math'?'append':'new'
}
function inkLassoCurrent(){return !inkLassoSession||inkLassoSession.selectionRevision===versionSession.selected?.revision&&JSON.stringify(inkLassoSession.originals.map(e=>get(e.id)))===inkLassoSession.baseline}
function updateInkPresentation(){
  const field=$('ink-result'),math=inkMode==='math',label=field.closest?.('label')||field.parentElement;field.hidden=math;field.readOnly=math;field.disabled=!!inkLassoSession?.capturing;if(label?.tagName==='LABEL')label.hidden=math;
  const preparing=!!inkLassoSession?.capturing;$('ink-mode-text').disabled=preparing;$('ink-mode-math').disabled=preparing;
  if(inkLassoSession)$('ink-recognize').disabled=preparing||!!inkLassoSession.captureError||!!inkRequest||!inkLassoCurrent();
  inkPad.setAttribute('aria-readonly',String(!!inkLassoSession));inkPad.style.cursor=inkLassoSession?'default':'crosshair';$('ink-undo').hidden=!!inkLassoSession;$('ink-clear').hidden=!!inkLassoSession;renderInk()
}
function currentLassoRegion(){return typeof lassoRegion!=='undefined'&&Array.isArray(lassoRegion)&&lassoRegion.length>=3}
function currentLassoInk(){return currentLassoRegion()&&typeof lassoInkSlices!=='undefined'&&Array.isArray(lassoInkSlices)&&lassoInkSlices.some(s=>s.graphic||s.visual||s.visualExtras||Array.isArray(s.inside)&&s.inside.length)}
function requestLassoHandwriting(mode=null){
  if(canvasDraftPending()){message('请先完成或取消正在编辑的内容，再圈选笔迹。');return false}
  if(currentLassoRegion()){
    if(mode==='text'||mode==='math')return openLassoInkPreview({mode});
    if(inkApplying){message('正在生成圈内图形，请稍候。');return false}
    lassoChoiceSession={region:JSON.stringify(lassoRegion),baseline:JSON.stringify(lassoInkSlices.map(s=>s.original)),selectionRevision:versionSession.selected?.revision};
    $('ink-choice-feedback').textContent=currentLassoInk()?'选择识别类型后自动识别圈内内容，校对确认后放入圈选位置。':'圈内没有可识别的文字、公式、图片或笔迹。取消后可重新圈选，当前圈线会保留。';
    $('ink-choice-dialog').showModal();return true
  }
  lassoRequestedMode=mode==='text'?'text':'math';setTool('lasso');message('用套索圈住画板上的笔迹，松手后点击左侧「识别」，再选择中文或公式。');return true
}
function closeLassoRecognitionChoice(){lassoChoiceSession=null;$('ink-choice-dialog').close()}
async function startLassoRecognition(mode){
  if(!$('ink-choice-dialog').open||!lassoChoiceSession)return false;
  const choice=lassoChoiceSession;
  if(!currentLassoRegion()||choice.region!==JSON.stringify(lassoRegion)||choice.baseline!==JSON.stringify(lassoInkSlices.map(s=>get(s.original.id)))||choice.selectionRevision!==versionSession.selected?.revision){closeLassoRecognitionChoice();message('圈选内容或选定版本已变化，请重新圈选。');return false}
  if(!currentLassoInk()){$('ink-choice-feedback').textContent='圈内没有可识别的文字、公式、图片或笔迹。取消后重新圈选，当前圈线会保留。';return false}
  closeLassoRecognitionChoice();
  const opening=openLassoInkPreview({mode}),session=inkLassoSession;
  if(!await opening||session!==inkLassoSession||!$('ink-dialog').open)return false;
  return recognizeInk()
}
async function openLassoInkPreview(options){
  if(inkApplying){message('正在生成圈内图形，请稍候。');return false}if(canvasDraftPending()){message('请先完成或取消正在编辑的内容。');return false}
  const slices=typeof lassoInkSlices!=='undefined'&&Array.isArray(lassoInkSlices)?structuredClone(lassoInkSlices).filter(s=>s.graphic||s.visual||s.visualExtras||Array.isArray(s.inside)&&s.inside.length):[],pens=slices.flatMap(s=>Array.isArray(s.inside)?s.inside:[]).filter(e=>e?.type==='pen'&&Array.isArray(e.points)&&e.points.length>=2);
  if(!slices.length){message('圈内没有可识别的文字、公式、图片或笔迹，请重新圈选。');return false}
  if(pens.length>200||pens.reduce((n,e)=>n+e.points.length,0)>20000){message('圈内笔迹太多，请分成较小区域识别。');return false}
  const originals=slices.map(s=>s.original),baseline=JSON.stringify(originals);
  if(originals.some(e=>!e?.id)||JSON.stringify(originals.map(e=>get(e.id)))!==baseline){message('圈选内容已变化，请重新圈选。');return false}
  const previous=loadInkDraft(),region=typeof lassoRegion!=='undefined'&&Array.isArray(lassoRegion)?structuredClone(lassoRegion):[];
  inkPaperSession=null;inkLassoSession={region,slices,originals,baseline,selectionRevision:versionSession.selected?.revision};inkSourceIds=originals.map(e=>e.id);inkSourceBaseline=baseline;inkTarget=null;inkOriginal=null;inkActive=null;
  inkStrokes=pens.length?fitStrokes(pens.map(penToStroke)):[];inkMode=options.mode==='text'?'text':'math';inkChanged();$('ink-dialog').showModal();setInkMode(inkMode);
  const session=inkLassoSession,revision=inkRevision;session.capturing=true;$('ink-keep').hidden=false;$('ink-feedback').textContent='正在准备圈内图形预览…';updateInkPresentation();
  try{
    const captured=await captureLassoRaster(session);
    if(session!==inkLassoSession||revision!==inkRevision||!$('ink-dialog').open||!inkLassoCurrent()){if(session===inkLassoSession){session.capturing=false;session.captureError=true;$('ink-feedback').textContent='准备预览时圈选内容或版本已变化，请重新圈选。';updateInkPresentation()}return false}
    parseImageSource(captured.src);if(!captured.bounds||!['x','y','width','height'].every(k=>Number.isFinite(captured.bounds[k]))||captured.bounds.width<=0||captured.bounds.height<=0)throw Error('圈选区域无效');
    session.image=captured.src;session.bounds=structuredClone(captured.bounds);session.capturing=false;session.captureError=false;
    if(previous?.lassoSession?.baseline===baseline&&previous.lassoSession.selectionRevision===session.selectionRevision&&JSON.stringify(previous.lassoSession.region)===JSON.stringify(region)&&previous.mode===inkMode){$('ink-result').value=previous.result||'';inkRecognition=previous.candidate||null;previewInkResult();$('ink-feedback').textContent='已恢复这一区域上次未确认的识别结果。'}else $('ink-feedback').textContent='请核对圈内预览，再识别中文或数学公式。';
    updateInkPresentation();saveInkDraft();checkInkService();return true
  }catch(error){if(session===inkLassoSession){session.capturing=false;session.captureError=true;$('ink-feedback').textContent='圈内预览未完成：'+(error.message||'请重新圈选。')+' 原内容与圈线保留。';updateInkPresentation()}return false}
}
function openHandwriting(options={}){
  if(!options.paper&&!options.expression&&currentLassoInk())options={...options,lasso:true,mode:options.mode||lassoRequestedMode};
  if(options.lasso)return openLassoInkPreview(options);
  if(!options.paper&&!options.expression&&(options.mode||options.type))return requestLassoHandwriting(options.mode||'math');
  inkLassoSession=null;if(inlineWritingOpen()&&!options.paper)options={paper:true,expression:paperActiveExpression};
  inkPaperSession=options.paper&&canvasDraft?.kind==='paper'?{target:canvasDraft.target,before:JSON.stringify(canvasDraft.value),expression:options.expression||null}:null;
  if(canvasDraftPending()&&!inkPaperSession){message('请先确认或取消当前编辑。');return}
  flushField();const pens=board.elements.filter(e=>selected.has(e.id)&&e.type==='pen');
  if(pens.reduce((n,e)=>n+e.points.length,0)>20000){message('选中的笔迹太多，请分批识别。');return}
  inkSourceIds=pens.map(e=>e.id);inkSourceBaseline=JSON.stringify(pens);inkTarget=selected.size===1&&chosen()?.type!=='pen'?chosen()?.id||null:null;
  const expressionId=typeof options?.expression==='string'?options.expression:null,expression=expressionId?inkExpression(inkPaperSession?canvasDraft.value:get(inkTarget),expressionId):null;
  if(expressionId&&!expression){message('原表达已变化，请重新选择要编辑的表达。');return}
  const previous=loadInkDraft(),saved=pens.length?null:expressionId?storedInk(expression):inkPaperSession?null:storedInk(chosen())||primaryMathInk(chosen());
  const matchesPaper=inkPaperSession&&previous?.paperSession?.target===inkPaperSession.target&&previous.paperSession.before===inkPaperSession.before&&previous.paperSession.expression===inkPaperSession.expression;
  const draft=inkPaperSession?(matchesPaper?previous:null):!previous?.lassoSession&&!previous?.paperSession&&!pens.length&&(!expressionId||(previous?.mode==='math'&&previous?.target===inkTarget&&previous?.destination==='edit:'+expressionId))&&(!saved||previous?.target===inkTarget)?previous:null;
  inkStrokes=pens.length?fitStrokes(pens.map(penToStroke)):draft?structuredClone(draft.strokes):saved?structuredClone(saved.strokes):[];
  const restored=draft||saved;if(restored){inkMode=restored.mode;inkSourceIds=Array.isArray(restored.sourceElements)?restored.sourceElements.filter(id=>typeof id==='string'):[]}
  if(expressionId||options.mode==='math'||pens.length)inkMode='math';else if(inkPaperSession&&!draft)inkMode='text';
  if(draft&&!inkPaperSession)inkTarget=get(draft.target)?.id||null;inkOriginal=storedInkBaseline(draft?.original,inkTarget)||inkBaseline(get(inkTarget));inkActive=null;inkChanged();$('ink-dialog').showModal();setInkMode(inkMode);
  if(expressionId&&!draft){inkDestinations('edit:'+expressionId);$('ink-result').value=expression.value;inkRecognition=saved?.candidate?structuredClone(saved.candidate):null;previewInkResult()}
  else if(saved){inkDestinations(inkMode==='math'?'edit:primary':'selected');$('ink-result').value=get(inkTarget)?.[inkMode==='math'?'math':'text']||'';inkRecognition=saved.candidate?structuredClone(saved.candidate):null;previewInkResult()}
  if(draft){inkDestinations(draft.destination);$('ink-result').value=typeof draft.result==='string'?draft.result:'';inkRecognition=draft.candidate||null;previewInkResult();$('ink-feedback').textContent='已恢复上次未确认的笔迹，可继续识别或校对。'}
  if(inkPaperSession)inkPaperSession.inkBefore=typeof draft?.paperSession?.inkBefore==='string'?draft.paperSession.inkBefore:inkDraftSnapshot();
  $('ink-keep').hidden=!!inkPaperSession;updateInkPresentation();saveInkDraft();checkInkService()
}
function setInkMode(mode){if(inkLassoSession?.capturing)return false;inkMode=mode==='math'?'math':'text';inkChanged();inkDestinations();$('ink-mode-text').setAttribute('aria-pressed',String(inkMode==='text'));$('ink-mode-math').setAttribute('aria-pressed',String(inkMode==='math'));$('ink-instructions').textContent=inkLassoSession?'这里预览圈内文字、公式、图片与笔迹。校对确认后放入圈选位置，现成文字、排版公式与导入图片会保留。':inkMode==='text'?'用鼠标、触控笔或手指写中文说明，建议每次写一行。':'识别结果以公式图形预览，原始笔迹在确认前始终保留。';updateInkPresentation()}
function inkPoint(ev){const r=inkPad.getBoundingClientRect();return[Math.max(0,Math.min(1000,(ev.clientX-r.left)*1000/r.width)),Math.max(0,Math.min(420,(ev.clientY-r.top)*420/r.height))]}
inkPad.addEventListener('pointerdown',ev=>{if(inkLassoSession){ev.preventDefault?.();return}if(ev.button!==0||inkActive)return;ev.preventDefault();if(inkStrokes.length>=200){$('ink-feedback').textContent='本次笔画较多，请分段识别。';return}inkActive={pointer:ev.pointerId,stroke:[inkPoint(ev)]};inkStrokes.push(inkActive.stroke);inkPad.setPointerCapture(ev.pointerId);inkChanged()});
inkPad.addEventListener('pointermove',ev=>{if(!inkActive||inkActive.pointer!==ev.pointerId)return;const p=inkPoint(ev),last=inkActive.stroke.at(-1);if(inkActive.stroke.length<1500&&inkStrokes.reduce((n,s)=>n+s.length,0)<20000&&Math.hypot(p[0]-last[0],p[1]-last[1])>.8)inkActive.stroke.push(p);renderInk()});
inkPad.addEventListener('pointerup',ev=>{if(inkActive?.pointer===ev.pointerId){inkActive=null;inkRevision++;saveInkDraft()}});
inkPad.addEventListener('pointercancel',ev=>{if(inkActive?.pointer===ev.pointerId){inkStrokes.pop();inkActive=null;inkChanged()}});
function inkImage(){if(inkLassoSession?.capturing)throw Error('圈内图形预览正在准备，请稍候。');if(inkLassoSession?.image)return inkLassoSession.image;const all=inkStrokes.flat();if(!all.length)throw Error('先在画板圈住需要识别的内容。');const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),left=Math.max(0,Math.min(...xs)-24),top=Math.max(0,Math.min(...ys)-24),right=Math.min(1000,Math.max(...xs)+24),bottom=Math.min(420,Math.max(...ys)+24),canvas=document.createElement('canvas');canvas.width=Math.max(64,Math.ceil((right-left)*1.6));canvas.height=Math.max(64,Math.ceil((bottom-top)*1.6));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(1.6,1.6);ctx.translate(-left,-top);ctx.strokeStyle='black';ctx.fillStyle='black';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';for(const s of inkStrokes){ctx.beginPath();ctx.moveTo(...s[0]);for(const p of s.slice(1))ctx.lineTo(...p);if(s.length===1){ctx.arc(s[0][0],s[0][1],2,0,Math.PI*2);ctx.fill()}else ctx.stroke()}return canvas.toDataURL('image/png')}
function inkConnectionError(error){return error.name==='AbortError'?'连接超时，请重试。':error.name==='TypeError'?'未能连接识别服务。':error.message||'识别服务暂不可用。'}
function recognitionError(value,fallback){return typeof value==='string'?value:value?.message||fallback}
async function inkJSON(url,options={}){const response=await fetch(url,{cache:'no-store',credentials:'omit',...options});let data;try{data=await response.json()}catch{throw Error('当前地址没有识别接口，请更新插件并重新构建画板。')}if(!response.ok||data.ok===false)throw Error(recognitionError(data.error,'识别服务请求失败（'+response.status+'）。'));return data}
function localInkHeaders(){return inkLocalConnection?.token?{'X-Anatomy-Recognition-Token':inkLocalConnection.token}:{}}
function localInkStatus(value){const provider=value.providers?.local;return value.error||provider?.error?'本地模型未就绪：'+recognitionError(value.error||provider.error,'请安装识别依赖。'):value.ready||provider?.ready?'本地中文与公式识别已就绪。':'本地服务已连接，模型将在首次识别时加载。'}
async function connectInkService(){
  if(inkProvider==='agent')return checkInkService();
  const seq=++inkServiceSequence;clearTimeout(inkServiceTimer);$('ink-reconnect').disabled=true;inkLocalConnection=null;
  let timeout,controller;
  try{
    inkEndpoint=recognitionOrigin($('ink-endpoint').value);saveInkPreferences();controller=new AbortController();timeout=setTimeout(()=>controller.abort(),6000);
    // Only the page's own legacy service can bypass the new handshake.
    if(!inkEndpoint){const health=await inkJSON('/api/health',{signal:controller.signal});if(health.service!=='anatomy-handwriting')throw Error('当前地址不是 Anatomy 识别服务。');if(!health.providers){if(seq!==inkServiceSequence)return false;inkLocalConnection={origin:'',legacy:true,connected:true};$('ink-service').textContent=localInkStatus(health)+'（兼容旧本地服务）';updateInkProviderControls();return true}}
    const data=await inkJSON(inkEndpoint+'/api/recognition/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
    if(seq!==inkServiceSequence||inkProvider!=='local')return false;
    if(typeof data.token!=='string'||!data.token)throw Error('服务未提供连接令牌，请更新插件后重启本地服务。');
    const expiresAt=typeof data.expiresAt==='number'?data.expiresAt:Date.parse(data.expiresAt);
    if(Number.isFinite(expiresAt)&&expiresAt<=Date.now())throw Error('本地服务连接令牌已过期，请重新连接。');
    const connection={origin:inkEndpoint,token:data.token,expiresAt:Number.isFinite(expiresAt)?expiresAt:Infinity,connected:true,legacy:false};
    const health=await inkJSON(inkEndpoint+'/api/recognition/health',{headers:{'X-Anatomy-Recognition-Token':data.token},signal:controller.signal});
    if(health.service!=='anatomy-handwriting')throw Error('当前地址不是 Anatomy 识别服务。');
    if(seq!==inkServiceSequence)return false;inkLocalConnection=connection;$('ink-service').textContent=localInkStatus(health);updateInkProviderControls();return true
  }catch(error){if(seq===inkServiceSequence){inkLocalConnection=null;$('ink-service').textContent=inkConnectionError(error)+' 笔迹仍保留，可点击「连接服务」。';updateInkProviderControls()}return false}
  finally{clearTimeout(timeout);if(seq===inkServiceSequence){$('ink-reconnect').disabled=false;if($('ink-dialog').open&&inkLocalConnection?.connected)inkServiceTimer=setTimeout(checkInkService,5000)}}
}
async function checkInkService(){
  const seq=++inkServiceSequence;clearTimeout(inkServiceTimer);$('ink-reconnect').disabled=true;
  let timeout,controller;
  try{
    controller=new AbortController();timeout=setTimeout(()=>controller.abort(),6000);
    if(inkProvider==='local'&&inkEndpoint&&!inkLocalConnection?.connected){$('ink-service').textContent='填写本机服务地址后点击「连接服务」。';return false}
    if(inkProvider==='local'&&inkLocalConnection?.token&&inkLocalConnection.expiresAt<=Date.now()){inkLocalConnection=null;throw Error('本地服务连接已过期，请点击「连接服务」。')}
    const local=inkProvider==='local'&&inkLocalConnection?.token;
    const v=await inkJSON(local?inkLocalConnection.origin+'/api/recognition/health':'/api/health',{signal:controller.signal,headers:local?localInkHeaders():{}});
    if(v.service!=='anatomy-handwriting')throw Error('当前地址没有连接 Anatomy 识别服务。');
    if(seq!==inkServiceSequence)return;
    if(inkProvider==='agent'){
      inkAgentAvailable=v.providers?.agent?.available===true;inkAgentMode=v.providers?.agent?.mode||null;
      $('ink-service').textContent=inkAgentAvailable?inkAgentMode==='executor'?'智能体识别已连接，可提交识别任务。':'智能体接管已就绪；提交后按下方提示让当前 DSH 或 Codex 处理。':!v.providers?'当前服务不支持智能体识别，请更新插件并重新构建画板。':'智能体识别暂不可用，请检查插件连接。';return inkAgentAvailable
    }
    if(!v.providers&&!inkEndpoint){inkLocalConnection={origin:'',legacy:true,connected:true};$('ink-service').textContent=localInkStatus(v)+'（兼容旧本地服务）'}
    else $('ink-service').textContent=inkLocalConnection?.connected?localInkStatus(v):'本地识别服务可用，请点击「连接服务」。';return !!inkLocalConnection?.connected
  }catch(error){if(seq===inkServiceSequence){inkAgentAvailable=false;$('ink-service').textContent=inkConnectionError(error)+' 笔迹仍保留，请点击「'+(inkProvider==='agent'?'检查智能体连接':'连接服务')+'」重新连接。'}return false}
  finally{clearTimeout(timeout);if(seq===inkServiceSequence){$('ink-reconnect').disabled=false;updateInkProviderControls();if($('ink-dialog').open&&(inkProvider==='agent'||inkLocalConnection?.connected))inkServiceTimer=setTimeout(checkInkService,5000)}}
}
function inkRequestId(){const cryptoAPI=typeof crypto!=='undefined'?crypto:null;if(cryptoAPI?.randomUUID)return cryptoAPI.randomUUID();const bytes=cryptoAPI?.getRandomValues?cryptoAPI.getRandomValues(new Uint8Array(16)):Array.from({length:16},()=>Math.floor(Math.random()*256));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)}
function waitInkAgent(signal){return new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);const error=Error('识别已停止');error.name='AbortError';reject(error)};if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},1000)})}
function showInkAgentRequest(request){const executor=inkAgentMode==='executor';$('ink-agent-waiting').hidden=false;$('ink-agent-handoff').hidden=executor;$('ink-agent-id').textContent=request.id;$('ink-agent-status').textContent=request.status==='processing'?'智能体正在识别，等待候选结果…':executor?'智能体任务已提交，等待处理…':'等待当前智能体接管；可复制下面的提示到 DSH 或 Codex。';$('ink-agent-prompt').value='请使用 anatomy_recognition 工具读取并接管识别任务 '+request.id+'，识别圈选中的'+(inkMode==='math'?'数学公式':'中文说明')+'并返回候选结果。保留原笔迹，由我在画板上校对确认。';$('ink-feedback').textContent=request.status==='processing'?'智能体正在识别。任务 '+request.id+'；原笔迹保留，请等待候选结果。':executor?'识别任务 '+request.id+' 已提交给配置的智能体，请等待候选结果。':'识别任务 '+request.id+' 正在等待接管。请复制下方提示，让当前 DSH 或 Codex 智能体处理。'}
async function recognizeInk(){
  if(inkLassoSession&&!inkLassoCurrent()){$('ink-feedback').textContent='圈选笔迹或选定版本已变化，请重新圈选。';return false}
  let image;try{image=inkImage()}catch(e){$('ink-feedback').textContent=e.message;return false}
  cancelInkRequest();const revision=inkRevision,seq=++inkSequence,mode=inkMode,provider=inkProvider,endpoint=inkEndpoint,session=inkLassoSession,version=versionSession.selected?.revision,sourceIds=[...inkSourceIds],sourceBaseline=JSON.stringify(sourceIds.map(get));let controller,timeout,agentRequest;
  const current=()=>revision===inkRevision&&seq===inkSequence&&session===inkLassoSession&&provider===inkProvider&&mode===inkMode&&endpoint===inkEndpoint&&$('ink-dialog').open;
  const sourceCurrent=()=>version===versionSession.selected?.revision&&JSON.stringify(sourceIds.map(get))===sourceBaseline&&inkLassoCurrent();
  $('ink-recognize').disabled=true;$('ink-apply').disabled=true;$('ink-feedback').textContent=provider==='agent'?'正在提交智能体识别任务…':'正在本机识别，首次加载模型可能需要较长时间…';saveInkDraft();
  try{
    controller=new AbortController();inkRequest=controller;timeout=setTimeout(()=>controller.abort(),provider==='agent'?600000:180000);let data;
    if(provider==='agent'){
      if(!inkAgentAvailable){if(!await checkInkService())throw Error($('ink-service').textContent)}
      if(!current()||!sourceCurrent())return false;
      agentRequest={id:inkRequestId(),cancelSent:false};inkAgentRequest=agentRequest;controller.signal.addEventListener('abort',()=>sendInkAgentCancel(agentRequest),{once:true});
      let response=await inkJSON('/api/recognition/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:agentRequest.id,mode,image,selectionRevision:version??null,sourceRevision:String(revision),sourceElements:sourceIds}),signal:controller.signal});
      while(true){
        if(!current()||controller.signal.aborted)return false;if(!sourceCurrent())throw Error('识别期间圈选内容或选定版本已变化，原内容保留，请重新圈选。');
        const request=response.request;if(!request||request.id!==agentRequest.id)throw Error('智能体返回的识别任务身份不一致，请重新识别。');
        if(request.status==='completed'){data=request.result;if(!data||typeof data.text!=='string'||data.mode&&data.mode!==mode)throw Error('智能体识别候选格式无效，请重新提交。');break}
        if(request.status==='failed'||request.status==='cancelled')throw Error(recognitionError(request.error,request.status==='cancelled'?'智能体识别已取消，原笔迹保留。':'智能体识别失败，请重新提交。'));
        if(!['pending','processing'].includes(request.status))throw Error('智能体识别任务状态无效，请重新提交。');
        showInkAgentRequest(request);await waitInkAgent(controller.signal);if(!current())return false;if(!sourceCurrent())throw Error('识别期间圈选内容或选定版本已变化，原内容保留，请重新圈选。');
        response=await inkJSON('/api/recognition/agent/'+encodeURIComponent(agentRequest.id),{signal:controller.signal})
      }
    }else{
      if(!inkLocalConnection?.connected){if(endpoint)throw Error('请先点击「连接服务」连接这台电脑上的本地识别服务。');if(!await connectInkService())throw Error($('ink-service').textContent)}
      if(!current()||!sourceCurrent())return false;
      if(inkLocalConnection.token&&inkLocalConnection.expiresAt<=Date.now()){inkLocalConnection=null;throw Error('本地服务连接已过期，请重新连接。')}
      data=await inkJSON(inkLocalConnection.legacy?'/api/recognize':inkLocalConnection.origin+'/api/recognition/local',{method:'POST',headers:{'Content-Type':'application/json',...localInkHeaders()},body:JSON.stringify({mode,image}),signal:controller.signal});
      if(!data.ok)throw Error(recognitionError(data.error,'识别失败，请重试。'))
    }
    if(!current()||controller.signal.aborted)return false;if(!sourceCurrent())throw Error('识别期间圈选内容或选定版本已变化，原内容保留，请重新圈选。');
    hideInkAgentRequest();checkInkService();inkRecognition={text:data.text||'',engine:data.engine||null,provider,...(agentRequest?{requestId:agentRequest.id}:{}),...(Array.isArray(data.scores)?{scores:data.scores}:{})};$('ink-result').value=data.text||'';previewInkResult();saveInkDraft();
    $('ink-feedback').textContent=data.text?'识别完成，请核对预览；确认后放入圈选位置。':'没有识别到内容，请回到画板调整笔迹后重新圈选。';return true
  }catch(e){sendInkAgentCancel(agentRequest);if(current()){$('ink-feedback').textContent=e.name==='AbortError'?'识别已停止或超时，笔迹已保留，可以重新识别。':e.name==='TypeError'?'识别请求未能连接到服务，笔迹已保留。请检查连接后重试。':e.message;hideInkAgentRequest()}return false}
  finally{clearTimeout(timeout);if(agentRequest&&inkAgentRequest===agentRequest)inkAgentRequest=null;if(seq===inkSequence){inkRequest=null;$('ink-recognize').disabled=false;if(revision===inkRevision)previewInkResult()}}
}
function previewInkResult(){const value=$('ink-result').value,parsed=inkMode==='math'?formulaMarkup(value,katex):{html:esc(value),error:null};$('ink-result-preview').innerHTML=parsed.error?'<p>暂不能排版这次结果，请调整笔迹后重新识别。</p>':parsed.html;const error=programTrace(value)?'识别结果包含程序表达，请调整笔迹后重新识别。':parsed.error?'暂不能排版这次结果，请调整笔迹后重新识别。':null;$('ink-result-error').textContent=error||'';$('ink-apply').disabled=inkApplying||!!inkLassoSession?.capturing||!inkLassoCurrent()||!value.trim()||!!error;updateInkPresentation()}
async function applyInkResult(){
  const value=$('ink-result').value.trim(),destination=$('ink-destination').value||'new';
  if(!value||programTrace(value)||(inkMode==='math'&&formulaMarkup(value,katex).error)){message('请先校对识别结果。');return}
  const handwriting={mode:inkMode,reviewed:true,candidate:inkRecognition?structuredClone(inkRecognition):null,sourceElements:inkSourceIds,strokes:structuredClone(inkStrokes),reviewedValue:value};
  if(inkLassoSession){
    if(inkApplying)return false;if(!inkLassoCurrent()){$('ink-feedback').textContent='圈选笔迹或选定版本已变化，结果保留，请重新圈选。';return false}
    inkApplying=true;$('ink-apply').disabled=true;
    try{return await applyRecognizedDrawing(value,handwriting)}catch{$('ink-feedback').textContent='未能生成识别图形，原笔迹保留，请重试。';return false}finally{inkApplying=false;if($('ink-dialog').open)previewInkResult()}
  }
  if(inkPaperSession){const error=paperInk(value,handwriting,inkPaperSession);if(error){$('ink-feedback').textContent=error;return}closeInk(true);message('已放入文稿，可继续编辑或撤销。');return}
  if(destination==='replace-ink')return await applyRecognizedDrawing(value,handwriting);
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
function closeInk(discard=false){if(discard===true){localStorage.removeItem(inkDraftKey);if(inkPaperSession&&canvasDraft?.kind==='paper'){canvasDraft.hasInkDraft=false;persistCanvasDraft()}}else saveInkDraft();cancelInkRequest();inkRevision++;inkServiceSequence++;clearTimeout(inkServiceTimer);inkActive=null;$('ink-dialog').close();inkPaperSession=null;inkLassoSession=null}
function keepInkSelection(){if(inkLassoSession){closeInk(true);message('圈选的原笔迹已保留。');return true}return keepDrawingInk()}
$('open-handwriting').addEventListener('click',()=>requestLassoHandwriting());$('ink-choice-text').addEventListener('click',()=>startLassoRecognition('text'));$('ink-choice-math').addEventListener('click',()=>startLassoRecognition('math'));$('ink-choice-cancel').addEventListener('click',closeLassoRecognitionChoice);$('ink-choice-dialog').addEventListener('cancel',ev=>{ev.preventDefault();closeLassoRecognitionChoice()});$('ink-close').addEventListener('click',closeInk);$('ink-dialog').addEventListener('cancel',closeInk);$('ink-mode-text').addEventListener('click',()=>setInkMode('text'));$('ink-mode-math').addEventListener('click',()=>setInkMode('math'));$('ink-undo').addEventListener('click',()=>{if(inkLassoSession)return;inkStrokes.pop();inkChanged()});$('ink-clear').addEventListener('click',()=>{if(inkLassoSession)return;inkStrokes=[];inkChanged()});$('ink-recognize').addEventListener('click',recognizeInk);$('ink-result').addEventListener('input',()=>{inkRevision++;cancelInkRequest();previewInkResult();saveInkDraft()});$('ink-reconnect').addEventListener('click',connectInkService);$('ink-disconnect').addEventListener('click',disconnectInkService);$('ink-provider').addEventListener('change',()=>setInkProvider($('ink-provider').value));$('ink-endpoint').addEventListener('input',()=>{inkEndpoint=$('ink-endpoint').value.trim();inkLocalConnection=null;inkServiceSequence++;clearTimeout(inkServiceTimer);inkChanged();$('ink-service').textContent='服务地址已修改，请点击「连接服务」。';$('ink-reconnect').disabled=false;$('ink-disconnect').disabled=true});$('ink-agent-copy').addEventListener('click',async()=>{const value=$('ink-agent-prompt').value;try{await navigator.clipboard.writeText(value);$('ink-agent-status').textContent='提示已复制，请粘贴到当前 DSH 或 Codex；画板正在等待候选结果。'}catch{$('ink-agent-prompt').focus();$('ink-agent-prompt').select?.();$('ink-agent-status').textContent='请选中并复制下面的提示，再粘贴到当前 DSH 或 Codex。'}});$('ink-destination').addEventListener('change',saveInkDraft);window.addEventListener('beforeunload',()=>{if($('ink-dialog').open){saveInkDraft();cancelInkRequest()}});$('ink-apply').addEventListener('click',applyInkResult);$('ink-keep').addEventListener('click',keepInkSelection);
window.__anatomyBoard.math={openFormulaLibrary,applyFormula,selectTemplate:selectFormulaTemplate,copyFormula:copyLibraryFormula,openHandwriting,requestLasso:requestLassoHandwriting,recognizeInk,applyInkResult,checkInkService,connectRecognition:connectInkService,disconnectRecognition:disconnectInkService,setRecognitionProvider:setInkProvider,get provider(){return inkProvider},get endpoint(){return inkEndpoint},get requestId(){return inkAgentRequest?.id||null},get picked(){return pickedLibraryMath},get strokes(){return inkStrokes},get mode(){return inkMode},get lassoSession(){return inkLassoSession}};
