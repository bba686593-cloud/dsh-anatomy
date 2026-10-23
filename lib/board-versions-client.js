function projectUnsaved(){return canvasDraftPending()||readingDraftChanged()||JSON.stringify(board)!==(versionSession.savedBoard||JSON.stringify(baseBoard))}
function boardUnsaved(){return JSON.stringify(board)!==(versionSession.savedBoard||JSON.stringify(baseBoard))}
function projectVersionStatus(){
  if(versionSession.busy)return '正在写入项目…'
  if(versionSession.error)return versionSession.error+(projectUnsaved()?' · 草稿已保留':'')
  if(canvasDraftPending()||readingDraftChanged())return '有未确认编辑 · 确认后再保存到项目'
  if(projectUnsaved())return '有未保存修改 · 点击保存写入项目'
  if(versionSession.selected)return '已保存到项目 · AI 将读取页面选定版本'
  return versionSession.connected?'项目保存已连接':'正在连接项目保存…'
}
async function versionRequest(path, payload){
  const response=await fetch(path,{method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,signal:typeof AbortSignal!=='undefined'&&AbortSignal.timeout?AbortSignal.timeout(25000):undefined})
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error?.message||data.error||'项目版本服务不可用');
  if(data.pluginVersion&&data.pluginVersion!==A.clientVersion){versionSession.updateVersion=data.pluginVersion;const notice=$('runtime-update');if(notice)notice.hidden=false}
  return data
}
function runtimeSpatialDraft(){return typeof spaceState!=='undefined'&&!!(spaceState?.gesture||spaceState?.placement||spaceState?.profileReady||spaceState?.depthPreview)||(typeof spaceInput!=='undefined'&&spaceInput?.busy())}
async function refreshRuntime(){
  if(versionSession.busy)return;
  if(runtimeSpatialDraft()){message('请先放置或取消当前空间草稿，再更新界面。');return}
  if(projectUnsaved()&&!await saveProjectVersion())return;
  if(projectUnsaved()||graphicBusy||canvasDraftPending()||readingDraftChanged()||runtimeSpatialDraft()){message('请先完成并保存当前编辑，再更新界面。');return}
  if(typeof location!=='undefined')location.reload()
}
function updateVersionSession(data,load=false){
  if(load&&data.board&&typeof spaceCancelGesture==='function')spaceCancelGesture()
  versionSession.connected=true;versionSession.error=null;versionSession.selected=data.selected;versionSession.versions=data.versions;versionSession.directory=data.directory;
  if(load&&data.board&&graphicBusy){versionSession.error='图形修改尚未完成，请完成后再切换版本';status();return}if(load&&data.board){flushField();const snapshot=JSON.stringify(board);const spatial=typeof spaceIsActive==='function'&&spaceIsActive();board=!spatial&&data.board.layout?.mode==='auto'?autoLayout(data.board):structuredClone(data.board);selected.clear();readingIndex=-1;if(typeof spaceBoardLoaded==='function')spaceBoardLoaded();render();if(!spatial&&board.layout?.mode==='auto')arrangeBoard(true);if(snapshot!==JSON.stringify(board))remember(snapshot);if(!spatial)fit()}
  if(data.board){versionSession.savedBoard=JSON.stringify(board);saveLocal()}
  renderVersions();status()
}
function renderVersions(){
  const select=$('version-list'),active=versionSession.selected?.id;
  select.innerHTML=versionSession.versions.map(v=>'<option value="'+esc(v.id)+'"'+(v.id===active?' selected':'')+'>'+esc(new Date(v.createdAt).toLocaleString()+' · '+v.label+(v.id===active?' · 当前选定':''))+'</option>').join('');
  $('version-choice').disabled=!versionSession.versions.length||versionSession.busy;
  $('version-state').textContent=versionSession.error||(!versionSession.versions.length?'还没有保存版本。点击「保存修改」即可在项目内创建第一版。':'当前选定版本会由 AI 直接读取。切换时，未保存的修改会先存成新版本。');
  $('version-current').textContent=active?'当前选定：'+(versionSession.versions.find(v=>v.id===active)?.label||'保存修改'):'尚未选定保存版本';
}
async function refreshProjectVersions(load=false){
  try{
    const data=await versionRequest('/api/versions'), changed=data.selected?.revision!==versionSession.selected?.revision, unloaded=versionSession.savedBoard===null;updateVersionSession(data);
    if(data.currentHash&&data.currentHash!==A.anatomyHash){versionSession.error='工程已更新，请刷新页面后核对；浏览器草稿已保留';status();renderVersions();return}
    if(load&&data.selected&&!graphicBusy&&!boardUnsaved()&&(changed||unloaded)){
      // Read without changing the shared selection or rebasing its version.
      const snapshot=await versionRequest('/api/versions/current');if(!graphicBusy&&!boardUnsaved())updateVersionSession(snapshot,true)
    }
  }catch(error){versionSession.error='项目保存未连接：'+error.message;renderVersions();status()}
}
async function saveProjectVersion(){
  if(typeof spaceCancelGesture==='function')spaceCancelGesture()
  if(typeof flushGraphicJobs==='function')await flushGraphicJobs();
  if(inlineWritingOpen()&&!finishInlineWriting())return false;
  flushField();if(canvasDraftPending()||readingDraftChanged()){message('请先确认或取消正在编辑的内容，再保存到项目。');return false}if(versionSession.busy)return false;
  const errors=boardDiagnostics(board,A.organs,A.flows);if(errors.length){message(errors[0].message);return false}
  versionSession.busy=true;status();$('save').disabled=true;
  try{
    // Capture now; edits made while this request runs remain unsaved.
    const snapshot=structuredClone(board), data=await versionRequest('/api/versions',{body:A.body.slug,board:snapshot,baseHash:A.anatomyHash,expectedSelection:versionSession.selected?.revision??null,label:$('version-name').value.trim()||'保存修改'});
    updateVersionSession({...data,board:undefined});versionSession.savedBoard=JSON.stringify(snapshot);saveLocal();$('version-name').value='';message('已保存到项目，并选定供 AI 读取。');return true
  }catch(error){versionSession.error='保存未完成：'+error.message;message(versionSession.error);return false}
  finally{versionSession.busy=false;$('save').disabled=false;renderVersions();status()}
}
async function chooseProjectVersion(){
  const id=$('version-list').value;if(!id||versionSession.busy)return;
  if(projectUnsaved()){
    const beforeSave=JSON.stringify(board);if(!await saveProjectVersion())return;
    if(beforeSave!==JSON.stringify(board)||canvasDraftPending()||readingDraftChanged()){message('保存期间又有新编辑，内容已保留。请先保存新修改，再切换历史版本。');return}
  }
  const beforeSelect=JSON.stringify(board);
  versionSession.busy=true;
  try{
    const data=await versionRequest('/api/versions/select',{id,baseHash:A.anatomyHash,expectedSelection:versionSession.selected?.revision??null});
    if(beforeSelect!==JSON.stringify(board)||canvasDraftPending()||readingDraftChanged()){
      updateVersionSession({...data,board:undefined});
      if(data.board)versionSession.savedBoard=JSON.stringify(data.board.layout?.mode==='auto'?autoLayout(data.board):data.board);
      saveLocal();message('历史版本已选定；等待期间的新编辑仍保留在画板。保存后 AI 才会读取新意图。');return
    }
    updateVersionSession(data,true);message('已选定此版本。AI 将按这一版读取意图。')
  }
  catch(error){versionSession.error=error.message;message(error.message)}
  finally{versionSession.busy=false;renderVersions();status()}
}
function measureBoardContent(){
  const measured={};
  for(const group of world.querySelectorAll?.('.element')||[]){const id=group.getAttribute('data-id'),e=get(id),copy=group.querySelector('.shape-copy'),content=copy?.firstElementChild;if(!e||!content)continue;
    if(e.type==='frame'){measured[id]={headerHeight:content.scrollHeight+24};continue}
    const ix=e.type==='diamond'?.72:e.type==='ellipse'?.82:1;
    measured[id]={width:Math.ceil((Math.max(copy.clientWidth,content.scrollWidth)+32)/ix),height:content.scrollHeight}
  }
  return measured
}
function arrangeBoard(presentation=false){
  flushField();const measured=measureBoardContent();
  if(presentation){board=autoLayout(board,measured);render()}
  else change(()=>{board=autoLayout(board,measured,{spatial:true});board.layout={...(board.layout||{}),mode:'auto'};});
  if(chosen())focusPart(chosen().id);else fit()
}
$('versions').addEventListener('click',async()=>{$('versions-dialog').showModal();await refreshProjectVersions(true)});
$('versions-close').addEventListener('click',()=>$('versions-dialog').close());
$('version-refresh').addEventListener('click',()=>refreshProjectVersions(true));
$('version-choice').addEventListener('click',chooseProjectVersion);
if($('runtime-refresh'))$('runtime-refresh').addEventListener('click',refreshRuntime);
$('auto-layout').addEventListener('click',()=>{arrangeBoard();message('已自动撑开文字并避让图形，可撤销。')});
$('manual-layout').checked=board.layout?.mode!=='auto';
$('manual-layout').addEventListener('change',()=>{const manual=$('manual-layout').checked;if(manual)change(()=>{board.layout={...(board.layout||{}),mode:'manual'}});else arrangeBoard();message(manual?'已保留自由绘画的位置，下次打开沿用。':'已启用自动避让。')});
window.addEventListener('focus',()=>refreshProjectVersions(true));
// Actual font/MathML measurements supplement the server's conservative sizing.
document.fonts?.ready.then(()=>{if(!(typeof spaceIsActive==='function'&&spaceIsActive())&&board.layout?.mode==='auto'){const clean=!projectUnsaved();arrangeBoard(true);if(clean){if(versionSession.savedBoard)versionSession.savedBoard=JSON.stringify(board);else Object.assign(baseBoard,structuredClone(board));saveLocal()} }});
refreshProjectVersions(true);
window.__anatomyBoard.versions={save:saveProjectVersion,refresh:refreshProjectVersions,choose:chooseProjectVersion,arrange:arrangeBoard};
