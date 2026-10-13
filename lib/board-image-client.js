// Images live with the board snapshot; no upload to a third-party service.
function imageFiles(list){return Array.from(list||[]).filter(f=>/^image\/(png|jpeg|webp)$/.test(f.type))}
function readBoardImage(file){return new Promise((resolve,reject)=>{if(file.size>MAX_IMAGE_BYTES){reject(Error('单张图片不能超过 6 MiB，请先压缩图片。'));return}const reader=new FileReader();reader.onerror=()=>reject(Error('无法读取图片，请重新选择。'));reader.onload=()=>{try{const src=String(reader.result),info=parseImageSource(src);resolve({src,alt:'插入的工程图片',width:info.width,height:info.height})}catch(error){reject(error)}};reader.readAsDataURL(file)})}
function imageAt(image,where,index=0){const r=surface.getBoundingClientRect(),scale=Math.min(1,480/image.width,320/image.height),width=Math.max(40,image.width*scale),height=Math.max(30,image.height*scale)+50;const e=makeElement('image',where?.x??(r.width/2-view.x)/view.scale-width/2,where?.y??(r.height/2-view.y)/view.scale-height/2,width,height);e.x+=index*24;e.y+=index*24;e.image=structuredClone(image);e.text='';return e}
function insertBoardImages(images,where){
  if(inlineWritingOpen()&&!finishInlineWriting())return false;if(canvasDraftPending()||readingDraftChanged()){message('请先完成或取消当前修改，再插入图片。');return false}
  const elements=images.map((image,i)=>imageAt(image,where,i)),next=structuredClone(board);
  for(const e of elements){if(!where){for(let attempt=0;attempt<=next.elements.length;attempt++){const hits=next.elements.filter(o=>!['line','arrow','frame'].includes(o.type)&&boxesOverlap(layoutBox(e),layoutBox(o),24));if(!hits.length)break;e.y=Math.max(...hits.map(o=>layoutBox(o).y+layoutBox(o).height))+24}}next.elements.push(e)}const errors=boardDiagnostics(next,A.organs,A.flows);
  if(errors.length){message(errors[0].message);return false}
  change(()=>{board=next;if(board.layout?.mode!=='manual')board=autoLayout(board);selected=new Set(elements.map(e=>e.id))});saveLocal();if(!where)fit();message('图片已放入画板，可移动、缩放；双击图注直接修改。');return true
}
async function importBoardImages(files,where){
  const supported=imageFiles(files);if(!supported.length){message('请选择 PNG、JPEG 或 WebP 图片。');return false}
  if(inlineWritingOpen()&&!finishInlineWriting())return false;if(canvasDraftPending()||readingDraftChanged()){message('请先完成或取消当前修改，再插入图片。');return false}
  const revision=versionSession.selected?.revision;try{const images=await Promise.all(supported.map(readBoardImage));if(revision!==versionSession.selected?.revision)throw Error('读取图片时选定版本已变化，请重新插入。');return insertBoardImages(images,where)}catch(error){message(error.message);return false}
}
$('insert-image').addEventListener('click',()=>{if(inlineWritingOpen()&&!finishInlineWriting())return;$('image-input').click()});
$('image-input').addEventListener('change',async ev=>{try{await importBoardImages(ev.target.files)}finally{ev.target.value=''}});
document.addEventListener('paste',ev=>{if(ev.target.closest?.('dialog'))return;const files=imageFiles(ev.clipboardData?.files?.length?ev.clipboardData.files:Array.from(ev.clipboardData?.items||[]).filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean));if(!files.length)return;ev.preventDefault();ev.stopPropagation?.();importBoardImages(files)},true);
surface.addEventListener('dragover',ev=>{if(ev.dataTransfer?.types?.includes('Files'))ev.preventDefault()});
surface.addEventListener('drop',ev=>{ev.preventDefault();const files=imageFiles(ev.dataTransfer?.files);if(files.length)importBoardImages(files,point(ev));else message('拖入 PNG、JPEG 或 WebP 图片即可插入。')});
window.__anatomyBoard.images={insert:insertBoardImages,importFiles:importBoardImages};
