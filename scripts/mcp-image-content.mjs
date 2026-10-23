import { createHash } from 'node:crypto'
import { imageDiagnostics, parseImageSource, MAX_BOARD_IMAGE_BYTES } from '../lib/images.js'
import { programTrace } from '../lib/semantics.js'
import { maskedImageSource } from '../lib/png-surface.js'

// Presentation only: the JSON tool contract stays intact in structuredContent.
// Inspect the returned current board, never scan files or historical versions.
export function mcpToolResult(name, value) {
  const structuredContent=typeof value==='object'&&value!==null?value:{value}
  if(name==='anatomy_recognition'){
    const content=[{type:'text',text:JSON.stringify(value,(key,next)=>key==='src'?'[圈选 PNG 见附加图片]':next)}]
    if(value?.ok&&value.image?.src){
      try{
        const parsed=parseImageSource(value.image.src),data=value.image.src.slice(value.image.src.indexOf(',')+1),hash=createHash('sha256').update(Buffer.from(data,'base64')).digest('hex')
        if(parsed.mime==='image/png'&&hash===value.request?.imageHash&&hash===value.image.sha256)content.push({type:'image',data,mimeType:parsed.mime})
      }catch{}
    }
    return{content,structuredContent,isError:value?.ok===false}
  }
  if(!['anatomy_selected_version','anatomy_board','anatomy_digest'].includes(name)||!value||typeof value!=='object')return{content:[{type:'text',text:JSON.stringify(value)}],structuredContent,isError:value?.ok===false}
  let elements=name==='anatomy_selected_version'?value.version?.board?.elements:name==='anatomy_board'?value.board?.elements:[],digestLines
  if(name==='anatomy_digest'&&typeof value.text==='string'){
    digestLines=value.text.split('\n');elements=[];let section=false
    for(let index=0;index<digestLines.length;index++){
      const line=digestLines[index]
      if(line==='## 自由画板与程序映射'){section=true;continue}
      if(section&&line.startsWith('## ')){section=false;continue}
      if(!section)continue
      const match=/^(- 图元 [A-Za-z0-9_-]+：)(\{.*\})$/.exec(line)
      if(match){try{const element=JSON.parse(match[2]);if(element?.type==='image')elements.push({element,index,prefix:match[1]})}catch{}}
    }
  }
  const sources=new Map(),pictures=new Map(),notes=[];let totalBytes=0,previewBytes=0
  for(const item of Array.isArray(elements)?elements:[]){
    const element=digestLines?item.element:item
    if(element?.type!=='image'||typeof element.image?.src!=='string')continue
    const image=element.image,src=image.src
    let record=sources.get(src)
    if(!record){
      record={summary:'[图片无法作为视觉内容预览；完整 image.src 保留在 structuredContent]',valid:false}
      sources.set(src,record)
      try{
        const parsed=parseImageSource(src),data=src.slice(src.indexOf(',')+1),hash=createHash('sha256').update(Buffer.from(data,'base64')).digest('hex')
        record={...record,parsed,data,hash,summary:'[内嵌图片 '+parsed.mime+'；'+parsed.width+'×'+parsed.height+'；'+parsed.bytes+' bytes；sha256:'+hash+'；完整 image.src 保留在 structuredContent]',valid:true}
        sources.set(src,record)
      }catch{}
    }
    if(record.parsed&&!record.counted){totalBytes+=record.parsed.bytes;record.counted=true}
    const original=element.formulaGraphic?.originalImage?.src
    if(typeof original==='string'&&!sources.has(original)){
      try{const parsed=parseImageSource(original),hash=createHash('sha256').update(Buffer.from(original.slice(original.indexOf(',')+1),'base64')).digest('hex');sources.set(original,{parsed,hash,data:original.slice(original.indexOf(',')+1),valid:true,counted:true,summary:'[内嵌图形 '+parsed.width+'×'+parsed.height+'；sha256:'+hash+'；完整 src 保留在 structuredContent]'});totalBytes+=parsed.bytes}catch{}
    }
    // A duplicate resource may have different alt/dimensions on another node;
    // validate the node independently before attaching its visual content.
    if(record.valid&&!imageDiagnostics(image).length&&!programTrace(image.alt)){
      try{
        const visual=maskedImageSource(element),parsed=visual===src?record.parsed:parseImageSource(visual),data=visual===src?record.data:visual.slice(visual.indexOf(',')+1),hash=visual===src?record.hash:createHash('sha256').update(Buffer.from(data,'base64')).digest('hex');
        if(!pictures.has(hash)){pictures.set(hash,{parsed,data,hash,nodes:[]});previewBytes+=parsed.bytes}
        pictures.get(hash).nodes.push({element:element.id,alt:image.alt,...(visual!==src?{erased:true,sourceSha256:record.hash}:{})})
      }catch(error){notes.push({element:element.id,note:'局部擦除后的图片暂时无法预览，未附加原图。'+error.message})}
    }else notes.push({element:element.id,note:'图片数据或说明未通过校验，未附加视觉内容。'})
  }
  if(totalBytes>MAX_BOARD_IMAGE_BYTES||previewBytes>MAX_BOARD_IMAGE_BYTES){pictures.clear();notes.push({note:'当前画板内嵌图片或擦除预览超过 8 MiB，未附加视觉内容；完整数据保留在 structuredContent。'})}
  const shorten=function(key,next){if(['image','originalImage'].includes(key)&&next&&typeof next==='object'&&typeof next.src==='string'){let record=sources.get(next.src);if(!record){try{const parsed=parseImageSource(next.src),hash=createHash('sha256').update(Buffer.from(next.src.slice(next.src.indexOf(',')+1),'base64')).digest('hex');record={summary:'[原始图形 '+parsed.width+'×'+parsed.height+'；sha256:'+hash+'；完整 src 保留在 structuredContent]'}}catch{record={summary:'[原图完整数据保留在 structuredContent]'}}}return {...next,src:record.summary}}return next}
  let displayed=value
  if(digestLines){
    for(const item of elements)digestLines[item.index]=item.prefix+JSON.stringify(item.element,shorten)
    displayed={...value,text:digestLines.join('\n')}
  }
  const content=[{type:'text',text:JSON.stringify(displayed,shorten)}]
  if(notes.length)content.push({type:'text',text:JSON.stringify({imageNotices:notes})})
  for(const picture of pictures.values()){
    content.push({type:'text',text:JSON.stringify({boardImage:{nodes:picture.nodes,mimeType:picture.parsed.mime,width:picture.parsed.width,height:picture.parsed.height,sha256:picture.hash}})})
    content.push({type:'image',data:picture.data,mimeType:picture.parsed.mime})
  }
  return{content,structuredContent,isError:value.ok===false}
}
