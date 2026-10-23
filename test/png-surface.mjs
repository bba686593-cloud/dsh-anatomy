import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { decodePng, encodePng, maskedImageSource } from '../lib/png-surface.js'
import { imageCaptionHeight, parseImageSource } from '../lib/images.js'

// Independent fixture encoder can emit all PNG row predictors and packed
// samples; the production encoder deliberately emits only RGBA/filter zero.
function fixture({width,height,type=6,depth=8,rows,filters=[],palette,transparency,interlace=0}) {
 const chunk=(name,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(name,4);data.copy(out,8);let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=depth;ihdr[9]=type;ihdr[12]=interlace;
 const channels={0:1,2:3,3:1,4:2,6:4}[type],bpp=Math.max(1,Math.ceil(channels*depth/8)),scan=[];
 const predict=(left,up,corner)=>{const p=left+up-corner,ds=[Math.abs(p-left),Math.abs(p-up),Math.abs(p-corner)];return ds[0]<=ds[1]&&ds[0]<=ds[2]?left:ds[1]<=ds[2]?up:corner};
 for(let y=0;y<height;y++){const filter=filters[y]||0,row=Buffer.from(rows[y]),prev=y?rows[y-1]:[];scan.push(Buffer.from([filter]),Buffer.from(row.map((n,x)=>{const a=x>=bpp?row[x-bpp]:0,b=prev[x]||0,c=x>=bpp?prev[x-bpp]||0:0;return(n-(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?predict(a,b,c):0))&255}))) }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...(palette?[chunk('PLTE',Buffer.from(palette))]:[]),...(transparency?[chunk('tRNS',Buffer.from(transparency))]:[]),chunk('IDAT',deflateSync(Buffer.concat(scan))),chunk('IEND',Buffer.alloc(0))]);
}
const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const opaque=(width=8,height=6)=>({width,height,data:Buffer.alloc(width*height*4,255)});
const formula=(erasures=[])=>({id:'formula',type:'image',width:320,height:240,image:{src:url(encodePng(opaque())),width:8,height:6},formulaGraphic:{},erasures});
const alphaAt=(image,x,y,sourceWidth=8,sourceHeight=6)=>image.data[(Math.floor((y+.5)*image.height/sourceHeight)*image.width+Math.floor((x+.5)*image.width/sourceWidth))*4+3];

test('PNG decoder restores all five row filters without losing color or alpha',()=>{
 const width=3,height=5,rows=Array.from({length:height},(_,y)=>Array.from({length:width*4},(_,x)=>(x*37+y*43)%256));
 const decoded=decodePng(fixture({width,height,rows,filters:[0,1,2,3,4]}));assert.equal(decoded.width,width);assert.equal(decoded.height,height);assert.deepEqual(decoded.data,Buffer.from(rows.flat()));
 const encoded=encodePng(decoded);assert.deepEqual(decodePng(encoded),decoded);assert.equal(parseImageSource(url(encoded)).width,width);
});

test('PNG RGB/grayscale transparency, gray-alpha and packed palette become exact RGBA pixels',()=>{
 const cases=[
  [{width:2,height:1,type:2,rows:[[17,34,51,68,85,102]],transparency:[0,17,0,34,0,51]},[17,34,51,0,68,85,102,255]],
  [{width:2,height:1,type:0,rows:[[80,160]],transparency:[0,80]},[80,80,80,0,160,160,160,255]],
  [{width:2,height:1,type:4,rows:[[80,90,160,170]]},[80,80,80,90,160,160,160,170]],
  [{width:4,height:1,type:3,depth:2,rows:[[0b00011011]],palette:[255,0,0,0,255,0,0,0,255,40,50,60],transparency:[255,160,80,0]},[255,0,0,255,0,255,0,160,0,0,255,80,40,50,60,0]],
  [{width:3,height:1,type:0,depth:1,rows:[[0b10100000]]},[255,255,255,255,0,0,0,255,255,255,255,255]],
  [{width:1,height:1,type:6,depth:16,rows:[[255,255,128,128,0,0,64,64]]},[255,128,0,64]],
 ];
 for(const [source,expected]of cases)assert.deepEqual([...decodePng(fixture(source)).data],expected);
});

test('Unchanged images retain identical bytes; erased ellipse and continuous segment change only covered alpha',()=>{
 const untouched=formula();assert.equal(maskedImageSource(untouched),untouched.image.src);
 const circle=formula([{surface:'body',points:[[.3125,.25]],radius:[.08,.1]}]),original=JSON.stringify(circle),out=decodePng(maskedImageSource(circle));assert.equal(alphaAt(out,2,1),0);assert.equal(alphaAt(out,0,0),255);assert.equal(alphaAt(out,7,5),255);assert.equal(JSON.stringify(circle),original);
 const line=formula([{surface:'body',points:[[.2,.25],[.8,.25]],radius:[.07,.09]}]),erased=decodePng(maskedImageSource(line));for(let x=1;x<=6;x++)assert.equal(alphaAt(erased,x,1),0);assert.equal(alphaAt(erased,4,4),255);
 assert.equal(maskedImageSource(line),maskedImageSource(line));assert.notEqual(maskedImageSource(line),maskedImageSource(circle));
});

test('Ordinary image erasures follow the displayed image aspect fit and caption carrier',()=>{
 const e={...formula(),formulaGraphic:undefined,text:'图片说明',width:400,height:300};e.image={src:url(encodePng(opaque(8,4))),width:8,height:4,alt:'图片说明'};
 const imageHeight=300-imageCaptionHeight(e),scale=Math.min(400/8,imageHeight/4),drawH=4*scale,offset=(imageHeight-drawH)/2;
 e.erasures=[{surface:'body',points:[[.3125,(offset+1.5*drawH/4)/300]],radius:[.04,.04]}];const out=decodePng(maskedImageSource(e));assert.equal(alphaAt(out,2,1,8,4),0);assert.equal(alphaAt(out,2,3,8,4),255);assert.equal(alphaAt(out,7,3,8,4),255);
});

test('3D surface erasures project onto flat formula XY while leaving original source intact',()=>{
 const e=formula([{surface:'body',points:[[.3125,.25,.5]],radius:[.08,.1,.2]}]),src=e.image.src;assert.equal(alphaAt(decodePng(maskedImageSource(e)),2,1),0);assert.equal(e.image.src,src);
 const label=formula([{surface:'label',points:[[.5,.5]],radius:[.2,.2]}]);assert.equal(maskedImageSource(label),label.image.src);
});

test('Malformed, unsupported, and inflated PNG data fail without pretending to be erased visuals',()=>{
 assert.throws(()=>decodePng(Buffer.alloc(50)),/PNG/);
 assert.throws(()=>decodePng(fixture({width:1,height:1,rows:[[0,0,0,255]],filters:[5]})),/滤波/);
 assert.throws(()=>decodePng(fixture({width:1,height:1,rows:[[0,0,0,255]],interlace:1})),/交错/);
 assert.throws(()=>decodePng(fixture({width:1,height:1,rows:[[0,0,0,255,7]]})),/buffer|length|large|size/i);
 assert.throws(()=>maskedImageSource(formula([{surface:'body',points:[[.5,.5]],radius:[0,.2]}])),/半径/);
 const unsupported={...formula([{surface:'body',points:[[.5,.5]],radius:[.2,.2]}]),image:{src:'data:image/webp;base64,UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoDAAIAAUAmJaACdLoAA5gA/u7T3/43jwK8l2V/7oMs4ZzAAAA=',width:3,height:2}};
 assert.throws(()=>maskedImageSource(unsupported),/未发送.*原图/);
});


test('Tiny erasures on a low-resolution source remain visible at the displayed carrier density',()=>{
 const e={...formula(),width:300,height:200,image:{src:url(encodePng(opaque(3,2))),width:3,height:2},erasures:[{surface:'body',points:[[.5,.5]],radius:[.02,.02]}]},src=e.image.src,out=decodePng(maskedImageSource(e));
 assert.ok(out.width>=300&&out.height>=200);assert.ok(out.width<=4096&&out.height<=4096&&out.width*out.height<=4194304);assert.equal(out.data[(Math.floor(out.height/2)*out.width+Math.floor(out.width/2))*4+3],0);assert.equal(out.data[(Math.floor(out.height/2)*out.width+Math.floor(out.width*.7))*4+3],255);assert.equal(e.image.src,src);
});
