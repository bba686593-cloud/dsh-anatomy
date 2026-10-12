// 解剖图前端：平面视图 + 立体视图（由 lib/render.js 内联进单文件 HTML）。
// 这份文件可以单独 node --check 与单元测试：所有函数都不依赖模块作用域。
var A = __PAYLOAD__;
var NODE_W = 210, GAP_X = 34, GAP_Y = 26, BAND_PAD = 18, BAND_HEAD = 34, STAGE_PAD = 8;
var COLORS = ['#63e6ff','#ffb454','#8affc1','#ff8ab5','#c9a6ff','#ffe066','#7fb2ff','#ff9f7a','#9be36b','#ff7ad9'];
var state = { mode:'human', view:'both', labels:'focus', drag3d:'orbit', depth:1, scenario:null, scenarioStep:0, regionFocus:null, q:'', sel:null, hover:null, isolate:null, mediaOff:{} };

function colorOf(list, id, fallbackIndex){
  var hit = null;
  for (var i=0;i<list.length;i++) if (list[i].id===id) hit=list[i];
  if (hit && typeof hit.hue === 'number') return 'hsl(' + hit.hue + ' 78% 62%)';
  var idx = 0; for (var j=0;j<list.length;j++) if (list[j].id===id) idx=j;
  return COLORS[(idx>=0?idx:(fallbackIndex||0)) % COLORS.length];
}
function mediumColor(id){ return colorOf(BODY().media||[], id, 1); }
function systemColor(id){ return colorOf(BODY().systems||[], id, 0); }
function organById(id){ for (var i=0;i<ORGANS().length;i++) if (ORGANS()[i].id===id) return ORGANS()[i]; return null; }
function mediumById(id){ for (var i=0;i<(BODY().media||[]).length;i++) if (BODY().media[i].id===id) return BODY().media[i]; return {id:id,name:id}; }
function systemById(id){ for (var i=0;i<(BODY().systems||[]).length;i++) if (BODY().systems[i].id===id) return BODY().systems[i]; return {id:id,name:id}; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function trunc(s,n){ s=String(s==null?'':s); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function nodeHeight(){ return state.mode==='agent' ? 104 : 68; }

/* ==================================================================
   共读编辑：人在图上直接改，AI 通过 anatomy_apply_edits 读走，改错能回退。
   做法是"副本 + 撤销栈"：改动先落在 overlay 上（图上立刻能看到效果），
   导出时与原始数据求差，得到一个只含改动字段的修改包。
   ================================================================== */
var editing = { overlay: null, undo: [], redo: [], dirty: 0, savedAt: null, barAction: null, barActionLabel: null };

function editableData(){
  if (!editing.overlay){
    editing.overlay = {
      body: JSON.parse(JSON.stringify(A.body)),
      organs: JSON.parse(JSON.stringify(A.organs)),
      flows: JSON.parse(JSON.stringify(A.flows)),
    };
  }
  return editing.overlay;
}
function BODY(){ return editing.overlay ? editing.overlay.body : A.body; }
function ORGANS(){ return editing.overlay ? editing.overlay.organs : A.organs; }
function FLOWS(){ return editing.overlay ? editing.overlay.flows : A.flows; }
function cleanList(list, key){
  if (!Array.isArray(list)) return [];
  return list.filter(function(item){
    if (typeof item === 'string') return item.trim() !== '';
    if (key) return String(item && item[key] || '').trim() !== '';
    return true;
  });
}
/* 只比较"人能编辑的那些字段"——机器算出来的东西不该被人手改动影响 */
function organEditable(o){
  return {
    math:o.math||'', acceptance:cleanList(o.acceptance), rules:o.rules||[],
    name: o.name || '',
    gist: o.gist || '', story: o.story || '',
    kind: o.kind || '', status: o.status || '', parent: o.parent || '',
    systems: cleanList(o.systems),
    not_responsible: cleanList(o.not_responsible),
    observables: cleanList(o.observables),
    composition: cleanList(o.composition, 'name').map(function(p){ return Object.assign({}, p, { name:p.name||'', role:p.role||'' }) }),
    contract: {
      in: cleanList((o.contract||{}).in), out: cleanList((o.contract||{}).out), invariants: cleanList((o.contract||{}).invariants),
    },
    anchors: cleanList(o.anchors, 'file').map(function(a){ return Object.assign({}, a, { file:(a.file||'').trim(), symbol:(a.symbol||'').trim() }) }),
  };
}
function flowEditable(f){
  return {
    math:f.math||'', acceptance:cleanList(f.acceptance), rules:f.rules||[], timing:f.timing,
    name: f.name || '',
    gist: f.gist || '', vessel: f.vessel || '',
    from: f.from || '', to: f.to || '', medium: f.medium || '', direction: f.direction || 'one-way',
    observables: cleanList(f.observables),
    payload: cleanList(f.payload, 'name').map(function(p){ return Object.assign({}, p, { name:p.name||'', role:p.role||'' }) }),
    anchors: cleanList(f.anchors, 'file').map(function(a){ return Object.assign({}, a, { file:(a.file||'').trim(), symbol:(a.symbol||'').trim() }) }),
  };
}
function sameJson(a, b){ return JSON.stringify(a) === JSON.stringify(b) }

function countPending(){
  var d = editableData(), n = 0;
  if ((d.body.oneline || '') !== (A.body.oneline || '') || (d.body.title || '') !== (A.body.title || '') || !sameJson(d.body.scenarios || [], A.body.scenarios || [])) n++;
  var byId = {}; A.organs.forEach(function(o){ byId[o.id] = o });
  d.organs.forEach(function(o){
    var before = byId[o.id];
    if (!before || !sameJson(organEditable(o), organEditable(before))) n++;
  });
  var seen = {}; d.organs.forEach(function(o){ seen[o.id] = 1 });
  A.organs.forEach(function(o){ if (!seen[o.id]) n++ });
  var fbyId = {}; A.flows.forEach(function(f){ fbyId[f.id] = f });
  d.flows.forEach(function(f){
    var before = fbyId[f.id];
    if (!before || !sameJson(flowEditable(f), flowEditable(before))) n++;
  });
  var fseen = {}; d.flows.forEach(function(f){ fseen[f.id] = 1 });
  A.flows.forEach(function(f){ if (!fseen[f.id]) n++ });
  editing.dirty = n;
  return n;
}
function pushUndo(){
  editableData();
  editing.undo.push(JSON.stringify(editing.overlay));
  if (editing.undo.length > 60) editing.undo.shift();
  editing.redo.length = 0;          // 新的改动作废重做栈
}
function undoEdit(){
  var snapshot = editing.undo.pop();
  if (!snapshot){ flashBar('没有更多可撤销的改动了'); return }
  editing.redo.push(JSON.stringify(editableData()));
  editing.overlay = JSON.parse(snapshot);
  countPending(); savePending(); updateBar(); render();
}
function redoEdit(){
  var snapshot = editing.redo.pop();
  if (!snapshot){ flashBar('没有可重做的改动了'); return }
  editing.undo.push(JSON.stringify(editableData()));
  editing.overlay = JSON.parse(snapshot);
  countPending(); savePending(); updateBar(); render();
}
function discardEdits(){
  editing.overlay = null; editing.undo = []; editing.redo = []; editing.dirty = 0; editing.savedAt = null;
  try { localStorage.removeItem(pendingKey()); } catch(e){}
  render();
}
function pendingKey(){ return 'anatomy-pending:' + (A.anatomyHash || A.body.slug || 'x'); }
function savePending(){
  try {
    localStorage.setItem(pendingKey(), JSON.stringify({ overlay: editing.overlay, at: Date.now() }));
  } catch(e){}
}
function restorePending(){
  try {
    var raw = localStorage.getItem(pendingKey());
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved && saved.overlay && saved.overlay.organs){
      editing.overlay = saved.overlay;
      countPending();
    }
  } catch(e){}
}

/* 生成修改包：只带改动的字段，AI 侧按字段合并 */
function buildBundle(){
  var d = editableData();
  var edits = [];
  var bodyPatch = {};
  if ((d.body.oneline || '') !== (A.body.oneline || '')) bodyPatch.oneline = d.body.oneline || '';
  if ((d.body.title || '') !== (A.body.title || '')) bodyPatch.title = d.body.title || '';
  if (!sameJson(d.body.scenarios || [], A.body.scenarios || [])) bodyPatch.scenarios = d.body.scenarios || [];
  if (Object.keys(bodyPatch).length) edits.push({ kind:'body', patch: bodyPatch });
  var before = {}; A.organs.forEach(function(o){ before[o.id] = o });
  d.organs.forEach(function(o){
    var patch = {}, now = organEditable(o), old = before[o.id] ? organEditable(before[o.id]) : null;
    Object.keys(now).forEach(function(k){ if (!old || !sameJson(now[k], old[k])) patch[k] = now[k] });
    if (!old) edits.push({ kind:'organ', id:o.id, create: Object.assign({ id:o.id, name:o.name, systems:o.systems||[], status:o.status||'planned' }, patch) });
    else if (Object.keys(patch).length) edits.push({ kind:'organ', id:o.id, patch: patch });
  });
  var alive = {}; d.organs.forEach(function(o){ alive[o.id] = 1 });
  A.organs.forEach(function(o){ if (!alive[o.id]) edits.push({ kind:'organ', id:o.id, remove:true }) });
  var fbefore = {}; A.flows.forEach(function(f){ fbefore[f.id] = f });
  d.flows.forEach(function(f){
    var patch = {}, now = flowEditable(f), old = fbefore[f.id] ? flowEditable(fbefore[f.id]) : null;
    Object.keys(now).forEach(function(k){ if (!old || !sameJson(now[k], old[k])) patch[k] = now[k] });
    if (!old) edits.push({ kind:'flow', id:f.id, create: Object.assign({ id:f.id, name:f.name, from:f.from, to:f.to, medium:f.medium }, patch) });
    else if (Object.keys(patch).length) edits.push({ kind:'flow', id:f.id, patch: patch });
  });
  var falive = {}; d.flows.forEach(function(f){ falive[f.id] = 1 });
  A.flows.forEach(function(f){ if (!falive[f.id]) edits.push({ kind:'flow', id:f.id, remove:true }) });
  return {
    schema: 'anatomy-edits/1',
    body: A.body.slug,
    baseHash: A.anatomyHash,
    actor: 'human',
    at: new Date().toISOString(),
    note: '由解剖图界面导出；用 anatomy_apply_edits 应用（会照常过体检门禁）',
    edits: edits,
  };
}

/* ---------- 视口工具：屏幕像素 ↔ SVG 用户坐标（含 preserveAspectRatio 的信箱偏移） ---------- */
function svgMetrics(svg){
  var vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
  var box = svg.getBoundingClientRect();
  var k = Math.min(box.width ? box.width/vb[2] : 1, box.height ? box.height/vb[3] : 1);
  return { vb:vb, box:box, k:k, offX:(box.width - vb[2]*k)/2, offY:(box.height - vb[3]*k)/2 };
}

/* ---------- 平面视图自己的视口：只在这个窗格内缩放/平移，不牵动页面 ---------- */
var view2d = { k:1, tx:0, ty:0, W:0, H:0, s0:1, offX:0, offY:0 };

function view2dApply(){
  var svg = document.getElementById('chart');
  if (!svg || !view2d.W) return;
  svg.setAttribute('viewBox',
    view2d.tx.toFixed(2) + ' ' + view2d.ty.toFixed(2) + ' ' +
    (view2d.W/view2d.k).toFixed(2) + ' ' + (view2d.H/view2d.k).toFixed(2));
}
/* 记录内容尺寸与"k=1 时的适应比例"，之后缩放平移都在此基准上算 */
function view2dFit(){
  var svg = document.getElementById('chart');
  if (!svg || !view2d.W) return;
  var box = svg.getBoundingClientRect();
  view2d.s0 = Math.min(box.width ? box.width/view2d.W : 1, box.height ? box.height/view2d.H : 1) || 1;
  view2d.offX = (box.width - view2d.W*view2d.s0)/2;
  view2d.offY = (box.height - view2d.H*view2d.s0)/2;
}

/* ---------- 布局：按系统分带，带内网格 ---------- */
function layout(){
  var time=temporalModel(BODY(),ORGANS(),FLOWS()), maxMs=Math.max.apply(null,[1].concat(time.nodes.map(function(x){return x.ms||0;})));
  var host=document.getElementById('pane-2d'),span=Math.max(180,(host?host.clientWidth:900)-NODE_W-70),pos={},rowH=nodeHeight()+GAP_Y;
  var nodes=time.nodes.slice().sort(function(a,b){return (a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);});
  nodes.forEach(function(node,k){pos[node.id]={x:30+(node.ms===null?span+NODE_W+50:node.ms/maxMs*span),y:140+k*rowH,w:NODE_W,h:nodeHeight()};});
  return {bands:[],pos:pos,width:span+NODE_W+70+(nodes.some(function(x){return x.ms===null;})?NODE_W+50:0),height:170+nodes.length*rowH,cols:1,temporal:time,timeSpan:span};
}

/* ---------- 绘制 ---------- */
function flowPath(a,b){
  var x1=a.x+a.w, y1=a.y+a.h/2, x2=b.x, y2=b.y+b.h/2;
  if (Math.abs(x2-x1) < 40){
    var midY = (y1+y2)/2 + (y1<y2? -34 : 34);
    return 'M'+x1+' '+y1+' C'+(x1+70)+' '+midY+','+(x2-70)+' '+midY+','+x2+' '+y2;
  }
  var dx = Math.max(48, Math.abs(x2-x1)/2.2);
  return 'M'+x1+' '+y1+' C'+(x1+dx)+' '+y1+','+(x2-dx)+' '+y2+','+x2+' '+y2;
}

function draw(){
  var L = layout();
  var svg = document.getElementById('chart');
  var media = BODY().media||[];
  var defs = '<defs>';
  for (var i=0;i<media.length;i++){
    defs += '<marker id="arw-'+esc(media[i].id)+'" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'+
            '<path d="M0,0 L9,4 L0,8 z" fill="'+mediumColor(media[i].id)+'"/></marker>';
  }
  defs += '</defs>';
  var out = defs;
  var focusOrgan = state.sel && state.sel.kind==='organ' ? state.sel.id : null;
  var focusFlow = state.sel && state.sel.kind==='flow' ? state.sel.id : null;
  var related = {};
  if (focusOrgan){
    related[focusOrgan]=true;
    for (var f=0;f<FLOWS().length;f++){ if (FLOWS()[f].from===focusOrgan||FLOWS()[f].to===focusOrgan){ related[FLOWS()[f].from]=true; related[FLOWS()[f].to]=true; } }
  }
  var hitQuery = function(o){
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return (JSON.stringify(o.anchors||[]) + JSON.stringify(o.composition||[])).toLowerCase().indexOf(q)>=0 || (o.name||'').toLowerCase().indexOf(q)>=0 || o.id.indexOf(q)>=0 || (o.gist||'').toLowerCase().indexOf(q)>=0;
  };

  /* 系统带 */
  for (var b=0;b<L.bands.length;b++){
    var band = L.bands[b], sc = systemColor(band.system.id);
    out += '<rect class="band" x="'+STAGE_PAD+'" y="'+band.y+'" width="'+(L.width-2*STAGE_PAD)+'" height="'+band.h+'" rx="16"/>';
    out += '<rect x="'+STAGE_PAD+'" y="'+band.y+'" width="4" height="'+band.h+'" rx="2" fill="'+sc+'" opacity="0.55"/>';
    out += '<text class="band-name" x="'+(STAGE_PAD+18)+'" y="'+(band.y+22)+'">'+esc(band.system.name)+'</text>';
    if (band.system.gist) out += '<text class="band-gist" x="'+(STAGE_PAD+18+band.system.name.length*15)+'" y="'+(band.y+22)+'">'+esc(band.system.gist)+'</text>';
  }

  /* 血脉（画在器官下面） */
  var flowEls = '';
  for (var k=0;k<FLOWS().length;k++){
    var flow = FLOWS()[k];
    var a = L.pos[flow.from], z = L.pos[flow.to];
    if (!a || !z) continue;
    var on = focusFlow===flow.id || (focusOrgan && (flow.from===focusOrgan||flow.to===focusOrgan));
    var dim = (focusFlow && !on) || (focusOrgan && !on) || state.mediaOff[flow.medium] === true;
    var color = mediumColor(flow.medium);
    var d = flowPath(a,z);
    var cls = 'flow' + (dim?' dim':'') + (on?' on pulse':'');
    flowEls += '<path class="'+cls+'" d="'+d+'" stroke="'+color+'" marker-end="url(#arw-'+esc(flow.medium)+')"'+(flow.direction==='two-way'?' marker-start="url(#arw-'+esc(flow.medium)+')"':'')+' style="color:'+color+'"/>';
    flowEls += '<path class="flow-hit" data-flow="'+esc(flow.id)+'" d="'+d+'"/>';
    if (on){
      var mx=(a.x+a.w+z.x)/2, my=(a.y+a.h/2+z.y+z.h/2)/2;
      flowEls += '<text class="flowlabel on" x="'+mx+'" y="'+(my-8)+'" text-anchor="middle">'+esc(trunc(flow.name||'数据传递',8)+' · '+timingText(flow).replace('传递耗时 ',''))+'<title>'+esc((flow.name||'数据传递')+' · '+timingText(flow))+'</title></text>';
    }
  }
  [0,0.5,1].forEach(function(r){var max=Math.max.apply(null,[1].concat(L.temporal.nodes.map(function(x){return x.ms||0;})));out+='<text x="'+(30+r*L.timeSpan)+'" y="115" font-size="12" fill="#9fb0c2">'+(r*max)+' 毫秒</text>';});
  out += '<text x="30" y="70" font-size="12" fill="#9fb0c2">横轴：入口至此的最短已知传递耗时</text><text x="30" y="88" font-size="12" fill="#9fb0c2">未知耗时另列；侧向间距仅用于阅读</text>';
  out += flowEls;

  /* 器官 */
  for (var n=0;n<ORGANS().length;n++){
    var organ = ORGANS()[n], p = L.pos[organ.id];
    if (!p) continue;
    var dim2 = (focusOrgan && !related[organ.id]) || !hitQuery(organ);
    var isOn = focusOrgan===organ.id;
    out += '<g class="node'+(dim2?' dim':'')+(isOn?' on':'')+'" data-organ="'+esc(organ.id)+'">';
    out += '<rect class="card" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'"/>';
    out += '<rect class="kindbar" x="'+p.x+'" y="'+(p.y+10)+'" width="3.5" height="'+(p.h-20)+'" fill="'+systemColor((organ.systems||[])[0])+'"/>';
    out += '<text class="name" x="'+(p.x+16)+'" y="'+(p.y+26)+'">'+esc(trunc(organ.name,18))+'</text>';
    out += '<text class="gist" x="'+(p.x+16)+'" y="'+(p.y+46)+'">'+esc(trunc(organ.gist,24))+'</text>';
    if (state.mode==='agent'){
      var comp = (organ.composition||[]).length, boundaries=(organ.not_responsible||[]).length;
      out += '<text class="meta" x="'+(p.x+16)+'" y="'+(p.y+66)+'">成分 '+comp+' · 边界 '+boundaries+' · 锚点 '+((organ.anchors||[]).length)+'</text>';
      if (organ.status) out += '<text class="meta" x="'+(p.x+16)+'" y="'+(p.y+84)+'">状态 '+esc(organ.status)+'</text>';
    }
    if ((organ.systems||[]).length>1){
      var label = '+' + ((organ.systems||[]).length-1);
      out += '<rect class="badge" x="'+(p.x+p.w-34)+'" y="'+(p.y+8)+'" width="26" height="15"/>';
      out += '<text class="badgetext" x="'+(p.x+p.w-21)+'" y="'+(p.y+19)+'" text-anchor="middle">'+esc(label)+'</text>';
    }
    out += '</g>';
  }
  view2d.W = L.width; view2d.H = L.height;
  view2dFit();
  view2dApply();
  svg.setAttribute('height', L.height);
  svg.innerHTML = out;
}


/* ==================================================================
   立体视图：平面是"读"，立体是"看懂"。
   世界坐标：x 横向、z 纵深（一个系统一层）、y 高度（抽象层级）。
   器官高度取它所属系统里最高的那层：判断浮在上面，体外世界贴地。
   ================================================================== */
/* 立体视图引擎在 chart-3d.js 里，由 render.js 内联拼接在本文件之前。 */

/* ---------- 侧栏 ---------- */
function tags(list){ return list.length? '<div class="tags">'+list.join('')+'</div>' : ''; }
function tag(text,color){ return '<span class="tag"'+(color?' style="border-color:'+color+';color:'+color+'"':'')+'>'+esc(text)+'</span>'; }

/* ---------- 可编辑字段 ---------- */
function ed(path, text, cls, placeholder){
  return '<span class="ed '+(cls||'')+'" contenteditable="true" spellcheck="false" data-edit="'+esc(path)+'"'+
         ' data-ph="'+esc(placeholder||'点这里填写')+'">'+esc(state.mode==='human'?humanText(text):text||'')+'</span>';
}
/* 列表编辑：已有条目逐条可改，末尾多留一个空行当"新增位"——留空即删除，写入即新增。
   opts.add / opts.addKey / opts.addVal 给这一栏自己的话：加什么、长什么样。
   以前每一栏都只显示"新增一行"，人看不出该往里写什么。 */
function listEditor(path, items, fields, placeholder, opts){
  var list = Array.isArray(items) ? items : [];
  var isObj = fields.length > 1;
  var hint = (opts && opts.add) || placeholder || '加一条';
  /* 两字段的列表（成分/锚点/血液成分）用 addKey + addVal 说清两格各写什么；
     只给了 add 时也别把它丢掉——退化成"第一格写这一整句"。 */
  var keyHint = (opts && opts.addKey) || (opts && opts.add ? '+ ' + opts.add : '+ 新增');
  var valHint = (opts && opts.addVal) || '它意味着什么';
  var rows = [];
  function row(item, index, extra){
    var del = extra ? '' : '<button class="row-del" data-del="'+esc(path+'.'+index)+'" title="删掉这一条">✕</button>';
    if (isObj){
      return '<li'+(extra?' class="add"':'')+'>' + fields.map(function(f){
        var value = item ? (item[f] || '') : '';
        var cls = f === 'name' || f === 'file' ? 'ed-key' : 'ed-val';
        return ed(path+'.'+index+'.'+f, value, 'ed-inline '+cls, extra ? (f==='name'||f==='file' ? keyHint : valHint) : placeholder);
      }).join('') + del + '</li>';
    }
    return '<li'+(extra?' class="add"':'')+'>' + ed(path+'.'+index, item || '', 'ed-inline', extra ? '+ ' + hint : placeholder) + del + '</li>';
  }
  list.forEach(function(item, i){ rows.push(row(item, i, false)) });
  rows.push(row(null, list.length, true));
  return '<ul class="ed-list">' + rows.join('') + '</ul>';
}
/* 单选取值：类型/状态/物质/起止这类"只能取有限几个值"的字段，改的是整个字段而不是某一行 */
function pickLine(label, path, value, options, opts){
  opts = opts || {};
  var cur = (value === undefined || value === null) ? '' : String(value);
  var items = (options || []).map(function(opt){
    var v = typeof opt === 'string' ? opt : opt.id;
    var t = typeof opt === 'string' ? opt : (opt.name || opt.id);
    return { v: v, t: t };
  });
  if (cur !== '' && !items.some(function(it){ return it.v === cur })) items.unshift({ v: cur, t: cur + '（当前值）' });
  var body = (opts.none ? '<option value=""'+(cur === '' ? ' selected' : '')+'>'+esc(opts.none)+'</option>' : '') +
    items.map(function(it){ return '<option value="'+esc(it.v)+'"'+(it.v === cur ? ' selected' : '')+'>'+esc(it.t)+'</option>' }).join('');
  return '<div class="fieldline"><span class="flabel">'+esc(label)+'</span>'+
    '<select class="ed-select" data-pick="'+esc(path)+'"'+(opts.delWhenEmpty ? ' data-pick-empty="del"' : '')+'>'+body+'</select></div>';
}
/* 多选取值：一个器官可以同属几个系统（解剖学上心脏既在循环系统也在神经系统里） */
function chipsLine(label, path, values, options){
  var cur = Array.isArray(values) ? values.slice() : [];
  var chips = cur.map(function(id){
    var sys = systemById(id);
    return '<span class="chip-edit" style="border-color:'+systemColor(id)+'">'+esc(sys ? sys.name : id)+
      '<button data-chip-del="'+esc(path)+'" data-chip-id="'+esc(id)+'" title="从这一项移出">✕</button></span>';
  }).join('');
  var left = (options || []).filter(function(s){ return cur.indexOf(s.id) < 0 });
  var add = left.length ? '<select class="ed-select" data-chip-add="'+esc(path)+'"><option value="">+ 挂到某个系统</option>'+
      left.map(function(s){ return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>' }).join('')+'</select>' : '';
  return '<div class="fieldline"><span class="flabel">'+esc(label)+'</span><span class="chips-edit">'+
    (chips || '<span style="color:#6b7f93">还没挂到任何系统</span>') + add + '</span></div>';
}
function findNode(path){
  var d = editableData(), p = path.split('.');
  var list = p[0] === 'organ' ? d.organs : d.flows, node = null;
  for (var i=0;i<list.length;i++) if (list[i].id === p[1]) node = list[i];
  return node;
}
/* path 指向"某个列表字段"本身（不带下标）：organ.<id>.observables / organ.<id>.contract.in */
function listAt(path){
  if (path.indexOf('body.') === 0){
    var v = editableData().body, keys = path.split('.').slice(1);
    for (var b=0;b<keys.length;b++) { if (!v[keys[b]]) v[keys[b]] = []; v = v[keys[b]]; }
    return v;
  }
  var node = findNode(path), p = path.split('.');
  if (!node) return null;
  if(p[2]==='rules' && p[4]==='limit') value=String(value).trim()===''?null:Number(value);
  if(p[2]==='timing'){node.timing=node.timing||{};node.timing[p[3]]=/Ms$/.test(p[3])?(String(value).trim()===''?null:Number(value)):value;return;}
  if (p[2] === 'contract'){
    node.contract = node.contract || {};
    node.contract[p[3]] = node.contract[p[3]] || [];
    return node.contract[p[3]];
  }
  node[p[2]] = node[p[2]] || [];
  return node[p[2]];
}
/* 下拉/多选/删除的统一落笔处：先记撤销点，再改 overlay，再重画 */
function applyValue(path, value, opts){
  opts = opts || {};
  pushUndo();
  if (opts.delWhenEmpty && (value === '' || value === null)){
    var node = findNode(path);
    if (node) delete node[path.split('.')[2]];
  } else {
    setPath(path, value);
  }
  countPending(); savePending(); updateBar(); render();
}
function delRow(path){
  var parts = path.split('.');
  var arr = listAt(parts.slice(0, -1).join('.'));
  var idx = parseInt(parts[parts.length - 1], 10);
  if (!Array.isArray(arr) || !(idx >= 0) || idx >= arr.length) return;
  pushUndo();
  arr.splice(idx, 1);
  countPending(); savePending(); updateBar(); render();
}
function chipToggle(path, id, on){
  var arr = listAt(path);
  if (!Array.isArray(arr)) return;
  var at = arr.indexOf(id);
  if (on && at < 0){ pushUndo(); arr.push(id); }
  else if (!on && at >= 0){ pushUndo(); arr.splice(at, 1); }
  else return;
  countPending(); savePending(); updateBar(); render();
}
function setPath(path, value){
  var d = editableData(), p = path.split('.');
  if (p[0] === 'body'){
    var target = d.body;
    for (var b=1;b<p.length-1;b++) { if (!target[p[b]]) target[p[b]] = /^\d+$/.test(p[b+1]) ? [] : {}; target = target[p[b]]; }
    target[p[p.length-1]] = value; return;
  }
  var list = p[0] === 'organ' ? d.organs : d.flows, node = null;
  for (var i=0;i<list.length;i++) if (list[i].id === p[1]) node = list[i];
  if (!node) return;
  if (p.length === 3){ node[p[2]] = value; return }
  if(p[2]==='rules' && p[4]==='limit') value=String(value).trim()===''?null:Number(value);
  if(p[2]==='timing'){node.timing=node.timing||{};node.timing[p[3]]=/Ms$/.test(p[3])?(String(value).trim()===''?null:Number(value)):value;return;}
  if (p[2] === 'contract'){
    node.contract = node.contract || {};
    var key = p[3], idx = parseInt(p[4], 10);
    node.contract[key] = node.contract[key] || [];
    ensureIndex(node.contract[key], idx, false);
    node.contract[key][idx] = value;
    return;
  }
  var field = p[2];
  node[field] = node[field] || [];
  if (p[4] !== undefined){
    var j = parseInt(p[3], 10);
    ensureIndex(node[field], j, true);
    node[field][j] = node[field][j] || {};
    node[field][j][p[4]] = value;
  } else {
    var k = parseInt(p[3], 10);
    ensureIndex(node[field], k, false);
    node[field][k] = value;
  }
}
function ensureIndex(arr, i, isObj){
  while (arr.length <= i) arr.push(isObj ? {} : '');
}
function addOrgan(){
  var d = editableData();
  var n = d.organs.length + 1, id = 'new-organ-' + n;
  pushUndo();
  d.organs.push({
    id: id, name: '新器官', gist: '', systems: [((BODY().systems||[])[0]||{}).id || 'core'],
    status: 'planned', not_responsible: [], observables: [], composition: [], anchors: [],
  });
  countPending(); savePending(); updateBar(); select('organ', id);
}
function viewOrgan(id){
  var list = ORGANS();
  for (var i=0;i<list.length;i++) if (list[i].id === id) return list[i];
  return null;
}
/* 删除是破坏性动作：第一次点变成"再点一次确认"，确认后才真删；删完在改动条上就地给撤销入口 */
var pendingDrop = null;
function dropOrgan(id){
  if (pendingDrop !== id){
    pendingDrop = id;
    var btn = document.getElementById('drop-organ');
    if (btn){ btn.textContent = '再点一次确认删除'; btn.classList.add('arming'); }
    flashBar('将删除「' + ((viewOrgan(id) || {}).name || id) + '」及其血脉：再点一次确认，或点别处取消');
    setTimeout(function(){
      if (pendingDrop === id){
        pendingDrop = null;
        var b2 = document.getElementById('drop-organ');
        if (b2){ b2.textContent = '删除这个器官'; b2.classList.remove('arming'); }
        updateBar();
      }
    }, 6000);
    return;
  }
  pendingDrop = null;
  var d = editableData();
  var name = (viewOrgan(id) || {}).name || id;
  pushUndo();
  d.organs = d.organs.filter(function(o){ return o.id !== id });
  d.flows = d.flows.filter(function(f){ return f.from !== id && f.to !== id });
  state.sel = null; countPending(); savePending(); render();
  flashBar('已删除「' + name + '」· 改动 ' + editing.dirty + ' 处还没保存到工程', '↶ 撤销删除', function(){ undoEdit(); updateBar(); });
}

/* ---------- 改动条：撤销 / 导出 / 复制 / 放弃 ---------- */
var redrawPending = false;
function scheduleRedraw(){
  if (redrawPending) return;
  redrawPending = true;
  requestAnimationFrame(function(){ redrawPending = false; draw(); draw3d(); });
}
/* 改动条常驻在底部：撤销/重做/保存永远看得见，不靠"有改动才出现"。
   这解决的正是"删了器官不知道去哪退回"——按钮就在眼前，删除后还会就地给一个撤销入口。 */
function updateBar(){
  var bar = document.getElementById('editbar');
  if (!bar) return;
  var label = document.getElementById('editbar-text');
  if (label){
    if (editing.dirty > 0 && editing.savedAt !== null){
      label.textContent = '改动 ' + editing.dirty + ' 处 · 已保存，等 AI 落地后刷新本页看结果';
    } else if (editing.dirty > 0){
      label.textContent = '改动 ' + editing.dirty + ' 处（还没保存到工程）';
    } else if (editing.redo.length > 0){
      label.textContent = '已撤销 · 可重做';
    } else {
      label.textContent = '图上文字都可直接点开修改';
    }
  }
  var canUndo = editing.dirty > 0 || editing.redo.length > 0;
  var canRedo = editing.redo.length > 0;
  var canSave = editing.dirty > 0;
  var btns = bar.querySelectorAll ? bar.querySelectorAll('button') : [];
  for (var i=0;i<btns.length;i++){
    var act = btns[i].getAttribute('data-act');
    var off = (act === 'undo' && !canUndo) || (act === 'redo' && !canRedo) ||
              ((act === 'export' || act === 'copy' || act === 'discard') && !canSave);
    if (off) btns[i].setAttribute('disabled','1'); else btns[i].removeAttribute('disabled');
  }
}
function flashBar(message, actionLabel, actionFn){
  var bar = document.getElementById('editbar');
  if (!bar) return;
  var label = document.getElementById('editbar-text');
  if (label) label.textContent = message;
  editing.barAction = actionFn || null;
  editing.barActionLabel = actionLabel || null;
  var ab = document.getElementById('bar-action');
  if (ab){
    if (editing.barAction){ ab.textContent = editing.barActionLabel; ab.style.display = ''; }
    else ab.style.display = 'none';
  }
}
/* 修改包：这是"人 → AI"的交接物。存进工程，或复制粘给 AI。 */
function bundleText(){ return JSON.stringify(buildBundle(), null, 2) }
function bundleName(){ return 'anatomy-edits-' + (BODY().slug || 'body') + '.json' }
function downloadText(text, name){
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
/* 「保存到工程」：能直接选路径就存进工程目录；否则退回下载，并告诉人放到哪 */
function saveBundle(){
  var bundle = buildBundle();
  if (bundle.edits.length === 0){ flashBar('没有改动可保存'); return }
  var text = bundleText(), name = bundleName();
  try {
    if (window.showSaveFilePicker){
      window.showSaveFilePicker({ suggestedName: name, types: [{ description: '解剖体修改包', accept: { 'application/json': ['.json'] } }] })
        .then(function(handle){ return handle.createWritable().then(function(w){ return w.write(text).then(function(){ return w.close() }) }) })
        .then(function(){ editing.savedAt = Date.now(); updateBar(); flashBar('已保存 ' + name + '：AI 打开工程就能读到', '复制内容', copyBundle); })
        .catch(function(){ downloadText(text, name); editing.savedAt = Date.now(); updateBar(); flashBar('已下载 ' + name + '：把它放进解剖体目录的 edits/ 下，AI 就会读到', '复制内容', copyBundle); });
      return;
    }
    downloadText(text, name);
    editing.savedAt = Date.now();
    updateBar();
    flashBar('已下载 ' + name + '：把它放进解剖体目录的 edits/ 下，AI 就会读到', '复制内容', copyBundle);
  } catch(e){ flashBar('浏览器不允许保存，请改用「复制」'); }
}
function copyBundle(){
  var bundle = buildBundle();
  if (bundle.edits.length === 0){ flashBar('没有改动可复制'); return }
  var text = JSON.stringify(bundle);
  var done = function(){ flashBar('修改包已复制到剪贴板：直接粘给 AI，让它 anatomy_apply_edits'); };
  var fail = function(){ flashBar('复制失败，请改用「导出」') };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
  else fail();
}

var DEPTH_NAMES = { 1:'① 外膜 · 这是啥', 2:'② 器官', 3:'③ 骨架', 4:'④ 脉络' };
/* 器官类型与状态的可选值：与 store.js 的 ORGAN_KINDS / status 归一化保持一致 */
var KIND_OPTIONS = [
  { id:'sense', name:'感知 · 把外面的事收进来' }, { id:'decide', name:'决策 · 拿主意' },
  { id:'act', name:'执行 · 动手' }, { id:'govern', name:'治理 · 定规矩、拦一道' },
  { id:'route', name:'通路 · 转交出去' }, { id:'store', name:'存储 · 留着' },
  { id:'report', name:'表达 · 说出来、画出来' }, { id:'adapt', name:'适配 · 换个形式' },
];
var STATUS_OPTIONS = [
  { id:'active', name:'已落地 · 有代码' }, { id:'planned', name:'设计态 · 还没写代码' },
  { id:'verified', name:'已核对 · 和代码对过' }, { id:'stale', name:'待复核 · 代码动过了' },
];
var KIND_NAME = {};
KIND_OPTIONS.forEach(function(k){ KIND_NAME[k.id] = k.name.split(' · ')[0] });
/* 由表及里的步进条：先知道这是啥、能干啥，再往里看骨头与血脉 */
function depthBar(){
  var out = '<div class="depthbar"><span class="depthlead">由表及里</span>';
  for (var d=1; d<=4; d++) out += '<button class="dstep'+(state.depth===d?' on':'')+'" data-depth="'+d+'">'+DEPTH_NAMES[d]+'</button>';
  return out + '</div>';
}
function deeper(d, text){ return '<button class="ghost deeper" data-depth="'+d+'">'+text+'</button>' }
function setDepth(d){
  d = Math.max(1, Math.min(4, d|0));
  if (state.depth === d) return;
  state.depth = d; render();
}
/* 这一层离外界多远：把 3D 用的同一套层位写到人眼前 */
function layerLine(o){
    var rank = anatomyRank();
    if (!rank.regionOf[o.id]) return '';
    var imp = Math.round((rank.impOf[o.id]||0)*100);
    return '　·　长在『'+organWhere(o)+'』　·　重要程度 '+imp+'%';
  }
var MAPPING_ROLE_NAMES = { implementation:'实现', interface:'接口', test:'测试', config:'配置', docs:'说明' };
function anchorEditor(path, anchors){
  var h = listEditor(path, anchors, ['file','symbol'], '仓库内相对路径', { addKey:'+ 加一条锚点，例：'+(path.indexOf('organ.')===0?'gap_nav/detector.py':'gap_nav/node.py'), addVal:'符号名，例：trace_corridor' });
  (anchors||[]).forEach(function(a,i){
    h += '<div class="evidence-row"><code>'+esc(a.file)+'</code>'+
      pickLine('映射用途', path+'.'+i+'.role', a.role||'implementation', Object.keys(MAPPING_ROLE_NAMES).map(function(k){ return {id:k,name:MAPPING_ROLE_NAMES[k]}; }))+
      '<p>'+ed(path+'.'+i+'.reason', a.reason, 'ed-block', '为什么这个文件对应这项职责？')+'</p></div>';
  });
  return h;
}
function scenarioReading(){
  var scenarios = BODY().scenarios || [];
  if (!scenarios.length) return '';
  var h = '<section class="scenario-reading"><h3>沿真实场景共读</h3><div class="reading-actions">';
  scenarios.forEach(function(sc){ h += '<button class="ghost" data-scenario="'+esc(sc.id)+'" aria-pressed="'+String(state.scenario===sc.id)+'">'+esc(sc.name)+'</button>'; });
  h += '</div>';
  var sc = scenarios.filter(function(x){ return x.id===state.scenario; })[0];
  if (sc){
    var idx = scenarios.indexOf(sc), path = 'body.scenarios.'+idx;
    h += '<p><b>触发：</b>'+ed(path+'.trigger',sc.trigger,'ed-inline')+'</p><ol class="scenario-steps">';
    (sc.steps||[]).forEach(function(step,i){
      var organ = organById(step.organ);
      h += '<li><button class="ghost" data-scenario-step="'+i+'" aria-current="'+(i===state.scenarioStep?'step':'false')+'">'+esc(organ?organ.name:step.organ)+(organ && organ.status==='planned'?' · 设计态':'')+'</button> '+
        ed(path+'.steps.'+i+'.action',step.action,'ed-inline')+(state.mode==='agent' && step.flow?' <code>'+esc(step.flow)+'</code>':'')+'</li>';
    });
    h += '</ol><p><b>结果：</b>'+ed(path+'.outcome',sc.outcome,'ed-inline')+'</p><h3>怎样算完成</h3>'+
      listEditor(path+'.acceptance',sc.acceptance,['value'],'验收条件',{add:'补一条可观察的验收条件'})+
      '<button class="ghost" data-scenario-clear="1">退出场景阅读</button>';
  }
  return h+'</section>';
}
function readerSummary(o){
  var c=o.contract||{}, h='<section class="reading-summary"><h3>这项职责怎样工作</h3>';
  h += '<p><b>收到：</b>'+esc((c.in||[]).join('；')||'输入尚未声明')+'</p>';
  h += '<p><b>交付：</b>'+esc((c.out||[]).join('；')||'输出尚未声明')+'</p>';
  if ((c.invariants||[]).length) h += '<p><b>必须保持：</b>'+esc(c.invariants.join('；'))+'</p>';
  if ((o.acceptance||[]).length) h += '<p><b>怎么验收：</b>'+esc(o.acceptance.join('；'))+'</p>';
  var related=FLOWS().filter(function(f){return f.from===o.id||f.to===o.id;});
  if (related.length) h += '<div class="reading-actions">'+related.map(function(f){
    var other=organById(f.from===o.id?f.to:f.from);
    return '<button class="ghost" data-goto-flow="'+esc(f.id)+'">'+esc(f.direction==='two-way'?'双向交接':f.from===o.id?'交给':'来自')+' '+esc(other?other.name:(f.from===o.id?f.to:f.from))+' · '+esc(f.gist)+'</button>';
  }).join('')+'</div>';
  var impact=impactOf(BODY(),ORGANS(),FLOWS(),{organs:[o.id],depth:1});
  if (impact.affected.length>1) h += '<p><b>修改后一起复核：</b>'+impact.affected.filter(function(x){return x.id!==o.id;}).map(function(x){return '<button class="ghost" data-goto-organ="'+esc(x.id)+'">'+esc(x.name)+'</button>';}).join(' ')+'</p>';
  if (impact.noTestEvidence.indexOf(o.id)>=0) h += '<p class="reading-gap">尚未关联测试证据；验收说明不代表测试已通过。</p>';
  return h+'</section>';
}
function verificationSummary(){
  var status=editing.dirty?'stale':(A.implementation||{}).status;
  var label={pass:'数值规则已通过所提供的测试证据',fail:'数值规则未满足',pending:'下层实现待验证',stale:'意图或实现已变，需重新验证',unconfigured:'尚未配置可检验规则'}[status]||'下层实现待验证';
  return '<p class="reading-gap">'+label+'。模型保存不等于实现通过。</p>';
}
function intentEditor(kind,o){
  var path=kind+'.'+o.id,h='<section class="intent"><h3>数学关系与上层意图</h3>'+verificationSummary();
  h+=ed(path+'.math',o.math,'ed-block','用数学关系说明输入怎样变成输出，并解释变量');
  h+=listEditor(path+'.acceptance',o.acceptance,['value'],'自然语言验收条件',{add:'补一条可以观察的验收条件'});
  (o.rules||[]).forEach(function(r,i){var p=path+'.rules.'+i;
    h+='<p>'+ed(p+'.statement',r.statement,'ed-block')+'</p><p>'+ed(p+'.metric',r.metric,'ed-inline')+' '+
      pickLine('关系',p+'.relation',r.relation,['≤','≥','='])+' '+ed(p+'.limit',String(r.limit),'ed-inline')+' '+ed(p+'.unit',r.unit,'ed-inline')+'</p>';
  });
  if(!(o.rules||[]).length) h+='<p>尚未绑定可自动核验的数值规则；自然语言意图仍需逐项落实与验证。</p>';
  if(kind==='flow' && o.timing){h+='<p>'+timingText(o)+'</p><p>耗时依据：'+ed(path+'.timing.method',o.timing.method,'ed-inline')+'</p>'; if(state.mode==='agent') h+=ed(path+'.timing.latencyMs',String(o.timing.latencyMs),'ed-inline','传递耗时，毫秒');}
  h+='<p>修改上层意图后，下层实现必须重新验证。</p>';
  if(kind==='organ') ['in','out','invariants'].forEach(function(k,i){h+='<h3>'+['收到什么','交付什么','必须保持'][i]+'</h3>'+listEditor(path+'.contract.'+k,(o.contract||{})[k],['value'],'自然语言或数学约束');});
  return h+'</section>';
}
function engineeringReading(o){
  var index=mappingIndex(BODY(),ORGANS(),FLOWS());
  var files=index.files.filter(function(f){return f.refs.some(function(r){return r.kind==='organ'&&r.id===o.id;});});
  var h='<section class="engineering-reading"><h3>工程文件与证据</h3>';
  if (!files.length) return h+'<p>尚未建立文件映射。</p></section>';
  files.forEach(function(f){
    h += '<div class="evidence-row"><code>'+esc(f.file)+'</code>';
    f.refs.forEach(function(r){
      h += '<p>'+esc(MAPPING_ROLE_NAMES[r.role]||r.role)+' · '+(r.kind==='organ'?'<button class="ghost" data-goto-organ="'+esc(r.id)+'">'+esc(r.name)+'</button>':esc(r.name))+
        (r.part?' / '+esc(r.part):'')+(r.symbol?' <code>'+esc(r.symbol)+'</code>':'')+'：'+esc(r.reason||'映射作用尚未说明')+'</p>';
    });
    h += '</div>';
  });
  return h+'<p class="reading-gap">这里只展示声明与文件证据；实际正确性仍需代码和测试核对。</p></section>';
}
function panel(){
  var el = document.getElementById('panel');
  if (!state.sel){
    el.innerHTML = scenarioReading()+'<div class="empty">先看立体图的<b>① 外膜</b>（这是啥），再按顶栏 <b>② 器官 → ③ 骨架 → ④ 脉络</b> 一层层揭开；<br>'+
      '点任意器官或血脉看细节。<br>'+
      '<span style="font-size:12px">以处理节点为支架，沿数据方向阅读，以传递耗时衡量路程。人读使用自然语言与数学语言；机读补充实现证据。<br>'+
      '步进条只决定画布看到第几层，不影响侧栏能改多少。</span>'+
      '<div class="sect" style="text-align:left">'+
        '<h3>这具身体</h3>'+
        '<div class="fieldline"><span class="flabel">名字</span>'+ed('body.title', BODY().title, 'ed-title', '这具身体叫什么')+'</div>'+
        '<p class="gist">'+ed('body.oneline', BODY().oneline, 'ed-gist', '一句话：整个系统在干什么')+'</p>'+
      '</div>'+
      '<div style="margin-top:16px"><button class="ghost" id="add-organ">+ 新器官（设计态）</button></div>'+
      '<div class="edit-hint">图上任何文字都可以直接点开修改；改完点下方「导出修改」交给 AI，或先撤销。</div></div>';
    var btn = document.getElementById('add-organ');
    if (btn) btn.addEventListener('click', addOrgan);
    return;
  }
  if (state.sel.kind === 'organ'){
    var o = null, all = ORGANS();
    for (var i=0;i<all.length;i++) if (all[i].id === state.sel.id) o = all[i];
    if (!o){ el.innerHTML = ''; return; }
    var planned = o.status === 'planned';
    var h = scenarioReading()+'<h2>'+ed('organ.'+o.id+'.name', o.name, 'ed-title')+'</h2><div class="sub">'+(state.mode==='agent'?esc(o.id):'数据处理节点')+(planned?' · <span class="planned">设计态</span>':'')+esc(layerLine(o))+'</div>';
    h += depthBar();
    h += readerSummary(o);
    h += tags((o.systems||[]).map(function(s){ return tag(systemById(s).name, systemColor(s)); })
      .concat(o.kind? [tag(KIND_NAME[o.kind]||o.kind)] : [])
      .concat(o.parent? [tag('构成 '+ (organById(o.parent)?organById(o.parent).name:o.parent))] : []));
    h += '<h3>一句话</h3><p class="gist">'+ed('organ.'+o.id+'.gist', o.gist, 'ed-gist', '一句话：这是什么器官')+'</p>';
    h += '<h3>叙述</h3><p>'+ed('organ.'+o.id+'.story', o.story, 'ed-block', '它怎么做、什么时候退让（写人话，不写实现）')+'</p>';
    h += '<div class="sect"><h3>它不负责什么</h3>'+listEditor('organ.'+o.id+'.not_responsible', o.not_responsible, ['value'], '边界：它不做什么', { add:'加一条边界，例：不做坐标变换' })+'</div>';
    h += intentEditor('organ',o);
    if(state.mode==='agent'){
    h += '<details class="engineering-details"'+(state.mode==='agent'?' open':'')+'><summary>工程对应与完整编辑</summary>';
    h += engineeringReading(o);
    if(o.implementation) h+='<h3>实现说明</h3><pre>'+esc(JSON.stringify(o.implementation,null,2))+'</pre>';
    /* 人读先看行为摘要；完整字段可以展开编辑，机读默认展开。 */
    h += '<div class="sect"><h3>它长在哪、算什么<span class="mach">机读</span></h3>';
    h += chipsLine('系统', 'organ.'+o.id+'.systems', o.systems, BODY().systems||[]);
    h += pickLine('类型', 'organ.'+o.id+'.kind', o.kind, KIND_OPTIONS, { none:'（未指定）', delWhenEmpty:true });
    h += pickLine('状态', 'organ.'+o.id+'.status', o.status, STATUS_OPTIONS);
    h += pickLine('构成自', 'organ.'+o.id+'.parent', o.parent,
      all.filter(function(x){ return x.id !== o.id }).map(function(x){ return { id:x.id, name:x.name } }),
      { none:'（不构成别的器官）', delWhenEmpty:true });
    h += '</div>';
    var c = o.contract || {};
    h += '<div class="sect"><h3>结构 · 由什么构成（骨骼）</h3>'+
      listEditor('organ.'+o.id+'.composition', o.composition, ['name','role'], '部件名',
        { addKey:'+ 加一个部件，例：射线投射', addVal:'这个部件干什么' })+'</div>';
    h += '<div class="sect"><h3>怎么看出它还活着</h3>'+
      listEditor('organ.'+o.id+'.observables', o.observables, ['value'], '可观测点',
        { add:'加一个可观测点，例：rviz 里青色的虚拟边界点' })+'</div>';
    h += '<div class="sect"><h3>契约 · 收进来什么</h3>'+
      listEditor('organ.'+o.id+'.contract.in', c.in, ['value'], '收进来什么', { add:'加一条：它需要什么才能干活' })+'</div>';
    h += '<div class="sect"><h3>契约 · 发出去什么</h3>'+
      listEditor('organ.'+o.id+'.contract.out', c.out, ['value'], '发出去什么', { add:'加一条：它交给下游什么' })+'</div>';
    h += '<div class="sect"><h3>契约 · 必须始终成立</h3>'+
      listEditor('organ.'+o.id+'.contract.invariants', c.invariants, ['value'], '始终成立的事', { add:'加一条不变量，例：虚拟段永远不参与巡线' })+'</div>';
    h += '<div class="sect"><h3>锚点（文件 + 符号名）<span class="mach">机读</span></h3>'+
      anchorEditor('organ.'+o.id+'.anchors', o.anchors)+'</div>';
    /* 血液与脉络：同样常显；步进条只影响画布 */
    var related = FLOWS().filter(function(f){ return f.from===o.id||f.to===o.id; });
    h += '<div class="sect"><h3>血液 · 进出它的血脉（脉络）</h3>';
    if (related.length) h += '<ul class="flowlinks">'+related.map(function(f){
      var dir = f.from===o.id ? '送出 → '+ (organById(f.to)?organById(f.to).name:f.to) : '接收 ← '+ (organById(f.from)?organById(f.from).name:f.from);
      var extra = f.vessel ? '（走 '+esc(f.vessel)+'）' : '';
      return '<li data-goto-flow="'+esc(f.id)+'" title="点开这条血脉"><span style="color:'+mediumColor(f.medium)+'">●</span> '+esc(mediumById(f.medium).name)+'：'+esc(dir)+extra+'</li>';
    }).join('')+'</ul>';
    else h += '<p style="color:#6b7f93">这个器官还没有连上任何血脉。</p>';
    if (state.depth < 4) h += deeper(4, '画布：把脉络也画出来 → ④ 脉络（'+related.length+' 条）');
    h += '</div>';
    h += '</details>';
    } else h += '<p>切换机读可查看实现位置与测试证据。</p>';
    h += '<div class="edit-hint">🗑 <button class="ghost danger" id="drop-organ">删除这个器官</button>（连同它的血脉）</div>';
    el.innerHTML = h;
    var db = document.getElementById('drop-organ');
    if (db) db.addEventListener('click', function(){ dropOrgan(o.id) });
    return;
  }
  var f = null, allF = FLOWS();
  for (var j=0;j<allF.length;j++) if (allF[j].id === state.sel.id) f = allF[j];
  if (!f){ el.innerHTML=''; return; }
  var from = organById(f.from), to = organById(f.to);
  var organOpts = ORGANS().map(function(x){ return { id:x.id, name:x.name } });
  var mediumOpts = (BODY().media||[]).map(function(m){ return { id:m.id, name:m.name } });
  var h2 = scenarioReading()+'<h2>'+ed('flow.'+f.id+'.name', f.name||f.id, 'ed-title')+'</h2><div class="sub">'+(state.mode==='agent'?esc(f.id):'数据传递')+'</div>';
  h2 += tags([tag(mediumById(f.medium).name, mediumColor(f.medium)), tag(f.direction==='two-way'?'双向':'单向')]);
  h2 += '<h3>一句话</h3><p class="gist">'+ed('flow.'+f.id+'.gist', f.gist, 'ed-gist', '这管血送的是什么')+'</p>';
  h2 += '<p class="reading-summary">'+esc(from?from.name:f.from)+(f.direction==='two-way'?' ⇄ ':' → ')+esc(to?to.name:f.to)+' · '+esc(timingText(f))+'</p>';
  h2 += intentEditor('flow',f);
  if(state.mode==='human'){el.innerHTML=h2+'<p>切换机读可查看传输通道与实现证据。</p>';return;}
  h2 += '<details class="engineering-details"'+(state.mode==='agent'?' open':'')+'><summary>工程对应与完整编辑</summary>';
  if(f.implementation) h2+='<h3>实现说明</h3><pre>'+esc(JSON.stringify(f.implementation,null,2))+'</pre>';
  h2 += '<div class="sect"><h3>从哪来、到哪去<span class="mach">机读</span></h3>';
  h2 += pickLine('起点', 'flow.'+f.id+'.from', f.from, organOpts);
  h2 += pickLine('终点', 'flow.'+f.id+'.to', f.to, organOpts);
  h2 += pickLine('物质', 'flow.'+f.id+'.medium', f.medium, mediumOpts);
  h2 += pickLine('方向', 'flow.'+f.id+'.direction', f.direction||'one-way',
    [{ id:'one-way', name:'单向' }, { id:'two-way', name:'双向（同一对器官来回送）' }]);
  h2 += '<div class="fieldline"><span class="flabel">走哪条管道</span>'+
    '<span class="ed-val">'+ed('flow.'+f.id+'.vessel', f.vessel, 'ed-inline', '话题 / 服务 / 文件 / 调用 / 电缆')+'</span></div>';
  h2 += '</div>';
  h2 += '<div class="sect"><h3>血里有什么</h3>'+
    listEditor('flow.'+f.id+'.payload', f.payload, ['name','role'], '成分名',
      { addKey:'+ 加一样成分，例：路径点', addVal:'它意味着什么' })+'</div>';
  h2 += '<div class="sect"><h3>怎么观测</h3>'+
    listEditor('flow.'+f.id+'.observables', f.observables, ['value'], '可观测点',
      { add:'加一个观测点，例：rostopic echo /gap/markers' })+'</div>';
  h2 += '<div class="sect"><h3>锚点（文件 + 符号名）<span class="mach">机读</span></h3>'+
    anchorEditor('flow.'+f.id+'.anchors', f.anchors)+'</div>';
  el.innerHTML = h2+'</details>';
}

/* ---------- 图例 ---------- */
function legends(){
  var media = BODY().media||[], systems = BODY().systems||[];
  document.getElementById('legend-media').innerHTML = media.map(function(m){
    return '<span class="chip" data-medium="'+esc(m.id)+'" aria-pressed="'+(state.mediaOff[m.id]?'false':'true')+'">'+
      '<span class="dash" style="color:'+mediumColor(m.id)+';border-top-style:'+(m.flow==='pulse'?'dashed':'solid')+'"></span>'+esc(m.name)+'</span>';
  }).join(' ');
  document.getElementById('legend-systems').innerHTML = systems.map(function(s){
    return '<span class="chip" data-system="'+esc(s.id)+'"><span class="dot" style="background:'+systemColor(s.id)+'"></span>'+esc(s.name)+'</span>';
  }).join(' ');
}

/* ---------- 头部与状态 ---------- */
function chrome(){
  var bn = document.getElementById('banner');
  if (bn){
    if (A.banner){ bn.textContent = A.banner; bn.style.display = 'block'; }
    else { bn.style.display = 'none'; }
  }
  document.getElementById('t-title').textContent = state.mode==='human'?humanText(BODY().title):BODY().title || BODY().slug;
  document.getElementById('t-oneline').textContent = state.mode==='human'?humanText(BODY().oneline):BODY().oneline || '';
  var humanLines = ORGANS().length + ' 个器官 · ' + FLOWS().length + ' 条血脉 · ' + (BODY().systems||[]).length + ' 个系统';
  document.getElementById('t-vitals').innerHTML = '<b>'+humanLines+'</b>　生成于 '+esc(String(A.generatedAt).slice(0,16).replace('T',' '))
    + (typeof ENGINE_BUILD === 'string' ? '　·　<b style="color:#63e6ff">'+esc(ENGINE_BUILD)+'</b>' : '');
  document.body.className = 'mode-' + state.mode + ' view-' + state.view;
  var btns = document.querySelectorAll('#mode-seg button');
  for (var i=0;i<btns.length;i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-mode')===state.mode));
  var vbtns = document.querySelectorAll('#view-seg button');
  for (var v=0;v<vbtns.length;v++) vbtns[v].setAttribute('aria-pressed', String(vbtns[v].getAttribute('data-view')===state.view));
  var LAYER_TIPS = {
    1:'① 外膜：先看全貌——这是一具什么样的身体、由哪几部分组成。按 ② 或顶栏「② 器官」揭开外膜看内部。',
    2:'② 器官：处理信息的地方，形状＝它干的事，大小＝有多扛事。点一个看细节；按 ③ 看它由什么构成。',
    3:'③ 骨架：数据处理节点，以及输入、变换、输出和必须保持的数学关系。',
    4:'④ 脉络：数据流动与交换——粗细＝载荷条目、颜色＝物质、箭头＝方向。点一根看它送什么。'
  };
  var lt = document.getElementById('layertip');
  if (lt) lt.textContent = LAYER_TIPS[state.depth] || '';
  /* 器官群：列在立体窗格最左侧的小列表，点一个只看那一群 */
  var gl = document.getElementById('grouplist');
  if (gl){
    var cl2 = clumpsOf(), rows2 = '';
    for (var gi=0; gi<cl2.ids.length; gi++){
      var g3 = cl2.map[cl2.ids[gi]];
      rows2 += '<span class="gl'+(state.regionFocus===g3.id?' on':'')+'" data-region="'+esc(g3.id)+'">'
             + '<span class="dot" style="background:'+systemColor(g3.id)+'"></span>'+esc(g3.name)
             + '<span class="n">'+g3.organs.length+'</span></span>';
    }
    gl.innerHTML = rows2;
  }
  var dbtns = document.querySelectorAll('#depth-seg button');
  for (var d=0;d<dbtns.length;d++) dbtns[d].setAttribute('aria-pressed', String(parseInt(dbtns[d].getAttribute('data-depth'),10)===state.depth));
  var lb = document.getElementById('labels');
  if (lb){
    lb.setAttribute('aria-pressed', String(state.labels==='all'));
    lb.textContent = state.labels==='all' ? '名字 · 全部' : '名字 · 邻域';
  }
}

function syncHash(){
  var parts = [];
  if (state.sel) parts.push(state.sel.kind+'='+state.sel.id);
  if (state.mode!=='human') parts.push('mode='+state.mode);
  if (state.view!=='both') parts.push('view='+state.view);
  history.replaceState(null,'', parts.length? '#'+parts.join('&') : location.pathname);
}
function readHash(){
  var raw = location.hash.replace(/^#/,'');
  if (!raw) return;
  raw.split('&').forEach(function(kv){
    var i = kv.indexOf('='); if (i<0) return;
    var k = kv.slice(0,i), v = decodeURIComponent(kv.slice(i+1));
    if (k==='organ'||k==='flow') state.sel = {kind:k,id:v};
    if (k==='mode') state.mode = v==='agent'?'agent':'human';
    if (k==='view') state.view = (v==='2d'||v==='3d') ? v : 'both';
  });
}

function render(){ chrome(); draw(); draw3d(); panel(); legends(); syncHash(); }
function select(kind,id){ state.sel = (state.sel && state.sel.kind===kind && state.sel.id===id) ? null : {kind:kind,id:id}; render(); }

var pan2d = null, dragged2d = false;
(function(){
  var svg = document.getElementById('chart');
  if (!svg) return;
  svg.addEventListener('wheel', function(ev){
    ev.preventDefault(); ev.stopPropagation();          // 只缩放这个窗格，页面不滚
    var m = svgMetrics(svg);
    var px = ev.clientX - m.box.left, py = ev.clientY - m.box.top;
    var s = view2d.k * view2d.s0;
    var ux = view2d.tx + (px - view2d.offX)/s, uy = view2d.ty + (py - view2d.offY)/s;
    view2d.k = clampNum(view2d.k * (ev.deltaY > 0 ? 0.9 : 1.111), 0.45, 6);
    s = view2d.k * view2d.s0;
    view2d.tx = ux - (px - view2d.offX)/s;
    view2d.ty = uy - (py - view2d.offY)/s;
    view2dApply();
  }, { passive:false });
  svg.addEventListener('pointerdown', function(ev){
    pan2d = { x:ev.clientX, y:ev.clientY, tx:view2d.tx, ty:view2d.ty };
    dragged2d = false;
    if (svg.setPointerCapture) { try { svg.setPointerCapture(ev.pointerId); } catch(e){} }
  });
  svg.addEventListener('pointermove', function(ev){
    if (!pan2d) return;
    var dx = ev.clientX - pan2d.x, dy = ev.clientY - pan2d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged2d = true;
    var s = view2d.k * view2d.s0;
    view2d.tx = pan2d.tx - dx/s;
    view2d.ty = pan2d.ty - dy/s;
    view2dApply();
  });
  function stopPan(){ pan2d = null; }
  svg.addEventListener('pointerup', stopPan);
  svg.addEventListener('pointercancel', stopPan);
  function reset2d(){ view2d.k = 1; view2d.tx = 0; view2d.ty = 0; view2dApply(); }
  svg.addEventListener('dblclick', reset2d);
  var r2 = document.getElementById('reset2d');
  if (r2) r2.addEventListener('click', reset2d);
})();

document.getElementById('chart').addEventListener('click', function(ev){
  if (dragged2d){ dragged2d = false; return; }          // 刚拖动过就不算点击
  var node = ev.target.closest('[data-organ]');
  if (node){ select('organ', node.getAttribute('data-organ')); return; }
  var flow = ev.target.closest('[data-flow]');
  if (flow){ select('flow', flow.getAttribute('data-flow')); return; }
  state.sel = null; render();
});
document.getElementById('mode-seg').addEventListener('click', function(ev){
  var b = ev.target.closest('button'); if (!b) return;
  state.mode = b.getAttribute('data-mode'); render();
});
document.getElementById('q').addEventListener('input', function(ev){ state.q = ev.target.value.trim(); draw(); });
document.getElementById('legend-media').addEventListener('click', function(ev){
  var c = ev.target.closest('[data-medium]'); if (!c) return;
  var id = c.getAttribute('data-medium'); state.mediaOff[id] = !state.mediaOff[id]; render();
});
document.getElementById('legend-systems').addEventListener('click', function(ev){
  var c = ev.target.closest('[data-system]'); if (!c) return;
  var id = c.getAttribute('data-system');
  var first = ORGANS().filter(function(o){ return (o.systems||[])[0]===id; })[0];
  if (first) select('organ', first.id);
});
document.getElementById('view-seg').addEventListener('click', function(ev){
  var b = ev.target.closest('button'); if (!b) return;
  state.view = b.getAttribute('data-view'); render();
});

/* 立体视图：拖动旋转、滚轮缩放、双击复位、悬停高亮、点球选中、点层名聚焦 */
(function(){
  var svg = document.getElementById('chart3d');
  if (!svg) return;
  var down = null, moved = 0;

  /* 拾取：器官优先（叠在一起时取最靠前的那个），没有器官时再找血脉 */
  function pick(px, py){
    var best = null;
    for (var i=0;i<pickCache.length;i++){
      var c = pickCache[i];
      var d = Math.sqrt(Math.pow(c.x-px,2) + Math.pow(c.y-py,2));
      if (d > (c.hit || 30)) continue;
      if (!best || c.depth < best.depth) best = c;
    }
    if (best) return { kind:'organ', id:best.id };
    var bestF = null, bestFD = null;
    for (var j=0;j<flowPick.length;j++){
      var f = flowPick[j];
      var df = Math.sqrt(Math.pow(f.x-px,2) + Math.pow(f.y-py,2));
      if (df > (f.hit || 12)) continue;
      if (!bestF || df < bestFD){ bestF = f; bestFD = df; }
    }
    return bestF ? { kind:'flow', id:bestF.id } : null;
  }
  function local(ev){
    var box = svg.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }
  function target(el){
    if (!el || !el.closest) return null;
    return el.closest('[data-system]') || el.closest('[data-region]');
  }

  svg.addEventListener('pointerdown', function(ev){
    /* 左键的作用由「拖动·平移 / 拖动·旋转」开关决定（默认平移）；
       右键、中键、Shift+左键永远是平移，所以两种手势随时都够得着。 */
    var withShift = ev.shiftKey === true;
    var panMode = (ev.button === 1 || ev.button === 2) ? true
                : (state.drag3d === 'pan' ? !withShift : withShift);
    down = { x:ev.clientX, y:ev.clientY, yaw:cam.yaw, pitch:cam.pitch, vx:view.x, vy:view.y, pan:panMode, el:ev.target };
    moved = 0; svg.classList.add('dragging');
    if (panMode) ev.preventDefault();
    if (svg.setPointerCapture) { try { svg.setPointerCapture(ev.pointerId); } catch(e){} }
  });

  svg.addEventListener('pointermove', function(ev){
    if (down){
      var dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (down.pan){
        var m = svgMetrics(svg);                    // 屏幕像素 → 窗口单位，做到跟手
        view.x = down.vx + dx/m.k;
        view.y = down.vy + dy/m.k;
      } else {
        cam.yaw = down.yaw + dx*0.0075;
        cam.pitch = clampNum(down.pitch + dy*0.006, 0.06, 1.45);
      }
      draw3d();
      return;
    }
    var p = local(ev), hit = pick(p.x, p.y);
    var id = hit && hit.kind === 'organ' ? hit.id : null;
    if (id !== state.hover){ state.hover = id; draw3d(); }
  });

  svg.addEventListener('pointerleave', function(){
    if (state.hover){ state.hover = null; draw3d(); }
  });

  svg.addEventListener('pointerup', function(ev){
    var was = down; down = null; svg.classList.remove('dragging');
    if (!was || moved >= 5) return;          // 拖过了就不算点击
    var sysEl = target(was.el);
    if (sysEl){
      var sid = sysEl.getAttribute('data-system');
      if (sid){                               // 点系统名 → 只看这个系统（再点一次取消）
        state.isolate = (state.isolate === sid) ? null : sid;
        render();
        return;
      }
      var reg = sysEl.getAttribute('data-region');
      if (reg){   // 点壳层名 → 只看这一层（由表及里的那一圈）
        state.regionFocus = (state.regionFocus === reg) ? null : reg;
        render();
        return;
      }
    }
    var p = local(ev), hit = pick(p.x, p.y);
    if (hit) select(hit.kind, hit.id);
    else { state.sel = null; state.isolate = null; render(); }
  });

  svg.addEventListener('pointercancel', function(){ down = null; svg.classList.remove('dragging'); });
  svg.addEventListener('wheel', function(ev){
    ev.preventDefault();
    ev.stopPropagation();
    /* 以光标为中心缩放：先把光标换算成"变换前的模型坐标"，缩放后再把同一个点摆回光标下 */
    var m = svgMetrics(svg);
    var px = ev.clientX - m.box.left, py = ev.clientY - m.box.top;
    var ux = ((px - m.offX)/m.k - view.x)/view.k, uy = ((py - m.offY)/m.k - view.y)/view.k;
    var k2 = clampNum(view.k * (ev.deltaY > 0 ? 0.9 : 1.111), 0.3, 6);
    view.x = (px - m.offX)/m.k - ux*k2;
    view.y = (py - m.offY)/m.k - uy*k2;
    view.k = k2;
    draw3d();
  }, { passive:false });
  svg.addEventListener('dblclick', resetCamera);
  svg.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });

  var spin = document.getElementById('spin');
  if (spin) spin.addEventListener('click', function(){
    cam.auto = !cam.auto;
    spin.setAttribute('aria-pressed', String(cam.auto));
    if (cam.auto && !spinHandle){
      var tick = function(){
        cam.yaw += 0.0045; draw3d();
        spinHandle = cam.auto ? requestAnimationFrame(tick) : null;
      };
      spinHandle = requestAnimationFrame(tick);
    }
  });

  var labels = document.getElementById('labels');
  if (labels) labels.addEventListener('click', function(){
    state.labels = (state.labels === 'all') ? 'focus' : 'all';
    render();
  });

  /* 窗口内的缩放与复位：按钮比手势好找，也和滚轮等价 */
  /* 按钮缩放以窗口中心为基准：模型整体变大变小，中心不动 */
  function zoomBy(factor){
    var k2 = clampNum(view.k * factor, 0.3, 6);
    var ratio = k2 / view.k;
    view.x *= ratio; view.y *= ratio; view.k = k2;
    draw3d();
  }
  function resetCamera(){
    cam.yaw = CAM_DEFAULT.yaw; cam.pitch = CAM_DEFAULT.pitch;   // 默认角度与立体引擎一致
    view.k = 1; view.x = 0; view.y = 0;
    state.isolate = null; state.regionFocus = null; render();
  }
  var zin = document.getElementById('zoom-in');
  if (zin) zin.addEventListener('click', function(){ zoomBy(1.12) });
  var zout = document.getElementById('zoom-out');
  if (zout) zout.addEventListener('click', function(){ zoomBy(1/1.12) });
  var rst = document.getElementById('reset3d');
  if (rst) rst.addEventListener('click', resetCamera);
  var depthSeg = document.getElementById('depth-seg');
  var depthBtns = depthSeg && depthSeg.querySelectorAll ? depthSeg.querySelectorAll('button') : document.querySelectorAll('#depth-seg button');
  for (var dbi=0; dbi<depthBtns.length; dbi++){
    (function(btn){
      btn.addEventListener('click', function(){ setDepth(parseInt(btn.getAttribute('data-depth'), 10)); });
    })(depthBtns[dbi]);
  }
  var dm = document.getElementById('dragmode');
  function paintDragMode(){
    if (!dm) return;
    dm.textContent = state.drag3d === 'pan' ? '拖动·平移' : '拖动·旋转';
    dm.setAttribute('aria-pressed', String(state.drag3d === 'orbit'));
    var hint = document.getElementById('hint3d');
    if (hint) hint.textContent = state.drag3d === 'pan'
      ? '左键拖动平移 · Shift/右键拖动旋转 · 滚轮缩放 · 双击复位'
      : '左键拖动旋转 · Shift/右键拖动平移 · 滚轮缩放 · 双击复位';
  }
  if (dm) dm.addEventListener('click', function(){
    state.drag3d = state.drag3d === 'pan' ? 'orbit' : 'pan';
    try { localStorage.setItem('anatomy-drag3d-v2', state.drag3d); } catch(e){}
    paintDragMode();
  });
  try {
    var savedDrag = localStorage.getItem('anatomy-drag3d-v2');
    if (savedDrag === 'pan' || savedDrag === 'orbit') state.drag3d = savedDrag;
  } catch(e){}
  paintDragMode();
})();

window.addEventListener('resize', function(){ draw(); draw3d(); });
window.addEventListener('hashchange', function(){ state.sel=null; readHash(); render(); });

var panelEl = document.getElementById('panel');
if (panelEl){
  var glEl = document.getElementById('grouplist');
  if (glEl) glEl.addEventListener('click', function(ev){
    var r = ev.target && ev.target.closest ? ev.target.closest('[data-region]') : null;
    if (!r) return;
    var rid2 = r.getAttribute('data-region');
    state.regionFocus = (state.regionFocus === rid2) ? null : rid2; render();
  });
  panelEl.addEventListener('click', function(ev){
    var pick = function(sel){ return ev.target && ev.target.closest ? ev.target.closest(sel) : null };
    var t = pick('[data-depth]');
    if (t){ ev.preventDefault(); setDepth(parseInt(t.getAttribute('data-depth'), 10)); return }
    var del = pick('[data-del]');
    if (del){ ev.preventDefault(); delRow(del.getAttribute('data-del')); return }
    var cd = pick('[data-chip-del]');
    if (cd){ ev.preventDefault(); chipToggle(cd.getAttribute('data-chip-del'), cd.getAttribute('data-chip-id'), false); return }
    var sc = pick('[data-scenario]');
    if (sc){ ev.preventDefault(); state.scenario=sc.getAttribute('data-scenario'); state.scenarioStep=0;
      var first=(BODY().scenarios||[]).filter(function(x){return x.id===state.scenario;})[0];
      if (first && first.steps.length){state.depth=Math.max(2,state.depth); select('organ',first.steps[0].organ);} return; }
    var stepButton=pick('[data-scenario-step]');
    if (stepButton){ev.preventDefault(); var current=(BODY().scenarios||[]).filter(function(x){return x.id===state.scenario;})[0];
      var stepIndex=Number(stepButton.getAttribute('data-scenario-step'));
      if(current && current.steps[stepIndex]){state.scenarioStep=stepIndex;select('organ',current.steps[stepIndex].organ);} return;}
    if(pick('[data-scenario-clear]')){ev.preventDefault();state.scenario=null;render();return;}
    var goOrgan=pick('[data-goto-organ]');
    if(goOrgan){ev.preventDefault();select('organ',goOrgan.getAttribute('data-goto-organ'));return;}
    var go = pick('[data-goto-flow]');
    if (go){ ev.preventDefault(); select('flow', go.getAttribute('data-goto-flow')); }
  });
  /* 下拉与多选不是 contenteditable，走 change：它们是"整字段替换"，不是逐字输入 */
  panelEl.addEventListener('change', function(ev){
    var el2 = ev.target;
    if (!el2 || !el2.getAttribute) return;
    var path = el2.getAttribute('data-pick');
    if (path){ applyValue(path, el2.value, { delWhenEmpty: el2.getAttribute('data-pick-empty') === 'del' }); return }
    var addPath = el2.getAttribute('data-chip-add');
    if (addPath && el2.value) chipToggle(addPath, el2.value, true);
  });
  panelEl.addEventListener('focusin', function(ev){
    if (ev.target && ev.target.closest && ev.target.closest('[data-edit]')) pushUndo();
  });
  panelEl.addEventListener('input', function(ev){
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-edit]') : null;
    if (!el) return;
    setPath(el.getAttribute('data-edit'), el.textContent);
    countPending(); savePending(); updateBar(); scheduleRedraw();
  });
  panelEl.addEventListener('keydown', function(ev){
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')){ ev.preventDefault(); undoEdit(); return }
    if (ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); if (ev.target.blur) ev.target.blur(); }
  });
}
var barEl = document.getElementById('editbar');
if (barEl){
  barEl.addEventListener('click', function(ev){
    var b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (b.id === 'bar-action'){ if (editing.barAction) editing.barAction(); return }
    if (act === 'undo'){ undoEdit(); return }
    else if (act === 'redo') redoEdit();
    else if (act === 'export') saveBundle();
    else if (act === 'copy') copyBundle();
    else if (act === 'discard') discardEdits();
  });
}
document.addEventListener('keydown', function(ev){
  var mod = ev.ctrlKey || ev.metaKey;
  /* 数字键切"由表及里"的深度：1 身份 / 2 骨骼 / 3 血脉 */
  if (!mod && (ev.key === '1' || ev.key === '2' || ev.key === '3' || ev.key === '4')){
    var t = ev.target || {};
    if (t.isContentEditable || t.tagName === 'INPUT') return;
    setDepth(parseInt(ev.key, 10));
    return;
  }
  if (!mod) return;
  var key = (ev.key || '').toLowerCase();
  if (key === 'z' && ev.shiftKey){ ev.preventDefault(); redoEdit(); return }
  if (key === 'z'){ ev.preventDefault(); undoEdit(); return }
  if (key === 'y'){ ev.preventDefault(); redoEdit(); }
});

/* 供无头测试读取修改包（与 3D 里的 window.__anatomy 同一套路，不是界面功能） */
if (typeof window !== 'undefined' && window) window.__anatomyEdits = buildBundle;

readHash(); restorePending(); countPending(); render(); updateBar();
