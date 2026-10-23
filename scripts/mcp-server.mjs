#!/usr/bin/env node
// Dependency-free standard MCP stdio bridge over the existing validated tools.
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { apply } from '../lib/index.js'
import { MAX_BOARD_REQUEST_BYTES } from '../lib/images.js'
import { mcpToolResult } from './mcp-image-content.mjs'
const defs=new Map(), rootIndex=process.argv.indexOf('--root')
const rootDir=rootIndex>=0?process.argv[rootIndex+1]:process.env.ANATOMY_PROJECT_ROOT||process.cwd()
apply({tools:{register:t=>defs.set(t.name,t)},logger:{info:m=>process.stderr.write(m+'\n')}},{rootDir,autoOpen:false})
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
const protocols=['2025-11-25','2025-06-18','2025-03-26','2024-11-05']
let initialized=false, ready=false
const send=value=>process.stdout.write(JSON.stringify(value)+'\n')
function invalid(value,schema,path='arguments'){
  if(schema.oneOf){if(schema.oneOf.some(s=>!invalid(value,s,path)))return null;return path+' does not match the schema'}
  if(schema.type){const valid=schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='array'?Array.isArray(value):schema.type==='integer'?Number.isInteger(value):schema.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===schema.type;if(!valid)return path+' has invalid type'}
  if(schema.enum&&!schema.enum.includes(value))return path+' has invalid value'
  if(schema.type==='object'){for(const k of schema.required||[])if(!(k in value))return path+'.'+k+' is required';for(const [k,v]of Object.entries(value)){const s=schema.properties?.[k];if(s){const err=invalid(v,s,path+'.'+k);if(err)return err}}}
  if(schema.type==='array'&&schema.items)for(let i=0;i<value.length;i++){const err=invalid(value[i],schema.items,path+'['+i+']');if(err)return err}
  return null
}
async function dispatch(msg){
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}})
  const id=msg.id??null
  if(msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return send({jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid Request'}})
  if(msg.id===undefined){if(msg.method==='notifications/initialized'&&initialized)ready=true;return}
  const error=(code,message)=>send({jsonrpc:'2.0',id,error:{code,message}}), result=value=>send({jsonrpc:'2.0',id,result:value})
  if(msg.method==='initialize'){
    if(initialized)return error(-32600,'Already initialized')
    initialized=true;return result({protocolVersion:protocols.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:protocols[0],capabilities:{tools:{}},serverInfo:{name:'anatomy',version},instructions:'Anatomy is a shared canvas for human–AI engineering work. Read the relevant project and current visual edits, then choose imagery, sketches, prose, mathematics or spatial forms to answer the user’s question; do not default to uniform boxes and arrows. Blank requirements need no structure model. Continue locally from the user’s marks and preserve unrelated content. Use anatomy_selected_version before implementation. Locate anatomy-* in the user project and pass dir. The page selection is authoritative; never apply every historical version. Re-read selectionRevision before applying. Saving intent does not prove source implementation.'})
  }
  if(msg.method==='ping')return result({})
  if(!ready)return error(-32002,'Server not initialized')
  if(msg.method==='tools/list')return result({tools:[...defs.values()].map(t=>({name:t.name,description:t.description,inputSchema:t.parameters,annotations:{readOnlyHint:t.behavior==='read',destructiveHint:t.behavior!=='read',openWorldHint:false}}))})
  if(msg.method==='tools/call'){
    const t=defs.get(msg.params?.name);if(!t)return error(-32602,'Unknown tool')
    const args=msg.params?.arguments??{}, issue=invalid(args,t.parameters);if(issue)return error(-32602,issue)
    const value=await t.execute(args);return result(mcpToolResult(t.name,value))
  }
  return error(-32601,'Method not found')
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})
for await(const line of lines){
  if(Buffer.byteLength(line)>MAX_BOARD_REQUEST_BYTES){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}});continue}
  let msg;try{msg=JSON.parse(line)}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});continue}
  try{await dispatch(msg)}catch(e){send({jsonrpc:'2.0',id:msg?.id??null,error:{code:-32603,message:e.message}})}
}
