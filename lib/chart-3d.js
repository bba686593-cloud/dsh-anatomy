// 立体视图引擎：由 lib/render.js 内联进 HTML（在 chart-client.js 之前拼接，同一个脚本作用域）。
// 依赖 chart-client.js 提供的 A / state / esc / trunc / systemColor / mediumColor。
//
// ── 这具身体长什么样，由工程结构决定，不是画好的动物 ──────────────────────
//   · **器官**＝处理信息的地方。形状按它干的事（kind / 系统）现场生成：
//       感受器 sense → 触须；判断 decide → 内核（球＋内环）；执行 act → 效应器（粗短突起）；
//       路由 route → 接头（环面）；存储 store → 囊（椭球＋箍）；治理 govern → 鞘（外套环）；
//       上报 report → 发射器（锥＋杆）；适配 adapt → 叶状团块。
//     大小＝使用重要程度（进出血脉、成分、契约、可观测点、边界、锚点加权）。
//   · **脉络**＝数据流动与交换：每条血脉一根血管，粗细∝载荷条目数、颜色＝物质、中点带方向箭头。
//   · **外膜**＝把全部器官与血管包住的包络（按位置主轴拟合的椭球），由这个工程的实际形状决定；
//     对外接口（与外界直接打交道的那批器官）穿出外膜，形成触须/口。
//   · **里外**＝数据流远近：从"直接与外界相连"的器官出发沿血脉数跳数，0 层贴膜、越往里越深。
//   · **器官群**＝按系统分簇（同一系统的器官聚在一起），簇标签可点，只看那一群。
//
// ── 观察者逐层解剖（state.depth 1..4，顶栏/侧栏步进条，数字键 1/2/3/4）──
//   ① 外膜：完整的一具（膜＋穿膜接口），先知道"这是啥、能干啥"
//   ② 器官：揭掉膜，看里面处理信息的东西（形状即职能）
//   ③ 骨架：器官＋成分节点＋契约环（它由什么构成、和谁约定了什么）
//   ④ 脉络：血管亮起、按物质着色标注，器官退成背景
// 左键拖动即旋转（Shift/右键平移、滚轮缩放、双击复位、右上角自转）。
var ENGINE_BUILD = '沿场景共读 · 按需展开工程证据';
var CAM_DEFAULT = { yaw:-0.92, pitch:1.34 };   // 默认近俯视：屏幕排布＝平面铺开（不重叠）；拖动可转成立体看
var cam = { yaw:CAM_DEFAULT.yaw, pitch:CAM_DEFAULT.pitch, auto:false };
var view = { k:1, x:0, y:0 };
var dragState = null, spinHandle = null, pickCache = [], flowPick = [], regionPick = [];

function clampNum(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function depth3d(){ var d = (typeof state!=='undefined' && state && state.depth) || 1; return d<1?1:(d>4?4:d); }

/* ── 把工程读成结构 ──────────────────────────────────────────────────── */
function sysAlt(id){
  var list = BODY().systems || [], idx = -1;
  for (var i=0;i<list.length;i++) if (list[i].id===id) idx=i;
  if (idx < 0) return 0.5;
  var sys = list[idx];
  return (typeof sys.alt === 'number') ? clampNum(sys.alt,0,1) : (list.length<=1 ? 0.5 : idx/(list.length-1));
}
/* 器官在世界坐标里的半径：0.5..1.0。屏幕上的大小由它投影得到，
   间距、层次半径都按这个尺度算——这样"球多大"和"留多少空"是同一套数。 */
function organWorldR(imp){ return 0.5 + 0.5*clampNum(imp,0,1); }
/* 球画多大：适中的小圈（重要度决定），长名字不把圈撑大，而是把字缩小塞进去 */
function organDrawR(o, imp, labeled){ return organWorldR(imp) * 1.5; }
/* 占位半径（分离约束/层容量/膜用）：重要度决定，留出触须与一点余量 */
var FOOT = {};
function organFootR(o){
  if (typeof o === 'number') return organWorldR(o) * 1.7;
  var v = FOOT[o && o.id];
  return (v == null) ? 0.9 : v;
}
function organImportance(o){
  var flows = FLOWS(), score = 0, i;
  for (i=0;i<flows.length;i++) if (flows[i].from===o.id || flows[i].to===o.id) score += 2;
  score += ((o.composition||[]).length) * 1.0;
  var c = o.contract || {};
  score += ((c.in||[]).length + (c.out||[]).length + (c.invariants||[]).length) * 0.8;
  score += ((o.observables||[]).length) * 0.6;
  score += ((o.not_responsible||[]).length) * 0.4;
  score += ((o.anchors||[]).length) * 0.6;
  return score;
}
/* 器官干的事：优先 kind，其次按系统名猜，最后按"有没有进出血脉"兜底 */
function organKind(o){
  var k = o.kind || '';
  var known = { sense:1, decide:1, act:1, govern:1, route:1, store:1, report:1, adapt:1 };
  if (known[k]) return k;
  var sys = (o.systems||[])[0] || '';
  var guess = { sensing:'sense', sense:'sense', decision:'decide', decide:'decide', motion:'act', act:'act',
                governance:'govern', govern:'govern', route:'route', store:'store', storage:'store',
                report:'report', interface:'report', outside:'sense', adapt:'adapt' };
  if (guess[sys]) return guess[sys];
  var flows = FLOWS(), ins = 0, outs = 0;
  for (var i=0;i<flows.length;i++){ if (flows[i].to===o.id) ins++; if (flows[i].from===o.id) outs++; }
  if (outs && !ins) return 'sense';
  if (ins && !outs) return 'act';
  return 'decide';
}
/* 里外：从"直接与外界相连"的器官出发，沿血脉数跳数 */
function organLayers(){
  var model=temporalModel(BODY(),ORGANS(),FLOWS()), values=Array.from(new Set(model.nodes.filter(function(x){return x.ms!==null;}).map(function(x){return x.ms;}))).sort(function(a,b){return a-b;}), dist={};
  model.nodes.forEach(function(x){dist[x.id]=x.ms===null?values.length:values.indexOf(x.ms);});
  return {dist:dist,maxLayer:values.length};
}
/* 器官群＝按系统分簇（同一系统聚在一起），带一个给人看的名字 */
function clumpsOf(){
  var organs = ORGANS(), out = {}, order = [];
  for (var i=0;i<organs.length;i++){
    var sid = (organs[i].systems||[])[0] || '_';
    if (!out[sid]){ out[sid] = { id:sid, name:(systemById(sid).name || sid), organs:[] }; order.push(sid); }
    out[sid].organs.push(organs[i]);
  }
  return { map:out, ids:order };
}
/* 面板与立体图共用同一套"在哪儿、多重要" */
function anatomyRank(){
  var organs = ORGANS(), maxImp = 1, i, lay = organLayers(), cl = clumpsOf();
  for (i=0;i<organs.length;i++) maxImp = Math.max(maxImp, organImportance(organs[i]));
  var impOf = {}, regionOf = {}, kindOf = {}, layerOf = {};
  for (i=0;i<organs.length;i++){
    var o = organs[i];
    impOf[o.id] = clampNum(organImportance(o)/maxImp, 0, 1);
    regionOf[o.id] = (o.systems||[])[0] || '_';
    kindOf[o.id] = organKind(o);
    layerOf[o.id] = lay.dist[o.id] || 0;
  }
  return { impOf:impOf, regionOf:regionOf, kindOf:kindOf, layerOf:layerOf, maxLayer:lay.maxLayer, clumps:cl.map };
}
function organWhere(o){
  var sid = (o.systems||[])[0] || '_';
  var rank = anatomyRank();
  var t=temporalModel(BODY(),ORGANS(),FLOWS()).nodes.filter(function(x){return x.id===o.id;})[0];
  return (rank.clumps[sid] ? rank.clumps[sid].name : '未归属') + '（入口至此：'+(t&&t.ms!==null?t.ms+' 毫秒':'耗时未知')+'）';
}

/* ── 位置：由血脉决定"谁挨着谁" ─────────────────────────────────────────
   先按器官群分扇区、按层定半径（稳定可读），再跑几轮松弛：
   有血脉相连的互相靠近（权重=载荷条目数），同层过近的互相推开，径向约束保持层半径。
   全程确定性（不随机），同一份数据每次画出来一模一样。 */
function scene(){
  var organs=ORGANS(), flows=FLOWS(), n=organs.length, i, j, rank=anatomyRank(), cl=clumpsOf();
  var time=temporalModel(BODY(),organs,flows), maxMs=Math.max.apply(null,[1].concat(time.nodes.map(function(x){return x.ms||0;})));
  var span=Math.max(24,n*4), pos={}, deg={}, edges=[], maxLayer=rank.maxLayer||0, rOuter=span;
  FOOT={};
  var groups=cl.ids.map(function(id){return cl.map[id];}), sectorOf={};
  groups.forEach(function(g,k){sectorOf[g.id]={a0:k/groups.length*Math.PI*2,a1:(k+1)/groups.length*Math.PI*2};});
  var ordered=time.nodes.slice().sort(function(a,b){return (a.ms===null?Infinity:a.ms)-(b.ms===null?Infinity:b.ms);});
  ordered.forEach(function(node,k){
    var o=organById(node.id); FOOT[node.id]=organWorldR(rank.impOf[node.id])*2.2;
    pos[node.id]={x:node.ms===null?span+10:node.ms/maxMs*span,y:0,z:(k-(n-1)/2)*8};
  });
  flows.forEach(function(f){if(pos[f.from]&&pos[f.to]) edges.push({a:f.from,b:f.to,w:1});});
  /* 外膜 + 取景：由当前位置拟合。屏幕分离要用"最终绘制时的半径"，所以先算一次膜。 */
  function computeMembrane(){
    var cx=0, cy=0, cz=0, k;
    for (k=0;k<n;k++){ cx+=pos[organs[k].id].x; cy+=pos[organs[k].id].y; cz+=pos[organs[k].id].z; }
    cx/=n||1; cy/=n||1; cz/=n||1;
    var ax=0, ay=0, az=0;
    for (k=0;k<n;k++){
      var Q = pos[organs[k].id];
      ax = Math.max(ax, Math.abs(Q.x-cx) + organFootR(organs[k]));
      ay = Math.max(ay, Math.abs(Q.y-cy) + organFootR(organs[k]));
      az = Math.max(az, Math.abs(Q.z-cz) + organFootR(organs[k]));
    }
    var mem = { c:{ x:cx, y:cy, z:cz }, a:[Math.max(3.4,ax), Math.max(2.4,ay), Math.max(3.4,az)] };
    var kM = 1;
    for (k=0;k<n;k++){
      var Q2 = pos[organs[k].id];
      var nxx=(Q2.x-mem.c.x)/mem.a[0], nyy=(Q2.y-mem.c.y)/mem.a[1], nzz=(Q2.z-mem.c.z)/mem.a[2];
      kM = Math.max(kM, Math.sqrt(nxx*nxx+nyy*nyy+nzz*nzz));
    }
    mem.a = [mem.a[0]*kM*1.06, mem.a[1]*kM*1.06, mem.a[2]*kM*1.06];
    var bb = { minX:mem.c.x-mem.a[0], maxX:mem.c.x+mem.a[0], minY:mem.c.y-mem.a[1], maxY:mem.c.y+mem.a[1],
               minZ:mem.c.z-mem.a[2], maxZ:mem.c.z+mem.a[2] };
    var rr = Math.max(bb.maxX-bb.minX, bb.maxZ-bb.minZ, bb.maxY-bb.minY, 12);
    return { membrane:mem, bounds:bb, rad:rr };
  }

  /* 说明：不再做"屏幕分离"——默认视角是俯视，屏幕排布就等于平面铺开，
     而平面铺开由"每层环半径按容量算"保证不重叠；再推反而会破坏这个最优排布。
     转动到斜角时，前后遮挡是三维的正常现象，靠深浅（后面的更暗）区分前后。 */
  var computed = computeMembrane();
  var membrane = computed.membrane, b = computed.bounds, rad = computed.rad;

  /* 器官群标签：贴在本群最外层器官之外，相邻群上下错开，避免挤在一起 */
  var clumpPick = [];
  for (i=0;i<groups.length;i++){
    var g = groups[i], mid = (sectorOf[g.id].a0 + sectorOf[g.id].a1)/2;
    var far = 0;
    for (j=0;j<g.organs.length;j++){
      var QQ = pos[g.organs[j].id];
      far = Math.max(far, Math.sqrt(QQ.x*QQ.x + QQ.z*QQ.z) + organFootR(g.organs[j]));
    }
    var rr2 = Math.min(membrane.a[0], Math.max(far + 0.8, membrane.a[0]*0.72));
    clumpPick.push({ id:g.id, x:Math.cos(mid)*rr2, y:(i%2 ? membrane.a[1]*0.75 : -membrane.a[1]*0.75),
                     z:Math.sin(mid)*rr2, count:g.organs.length, name:g.name });
  }

  return { pos:pos, rank:rank, membrane:membrane, clumps:groups, clumpPick:clumpPick, bounds:b,
           center:membrane.c, rad:rad, rOuter:rOuter, maxLayer:maxLayer, edges:edges, temporal:time };
}

function projector(sc){
  var cyw=Math.cos(cam.yaw), syw=Math.sin(cam.yaw), cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch);
  var dist = sc.rad*1.05;
  return function(p){
    var dx=p.x-sc.center.x, dy=p.y-sc.center.y, dz=p.z-sc.center.z;
    var x1=dx*cyw - dz*syw, z1=dx*syw + dz*cyw;
    var y1=dy*cp - z1*sp, z2=dy*sp + z1*cp;
    var depth = Math.max(0.9, z2+dist);
    var f = (sc.rad*1.28)/depth;
    return { x:x1*f, y:-y1*f, depth:depth, f:f };
  };
}
/* 椭球的投影：三个半轴分别投影，取最长两条当长短轴 */
function projEllipsoid(P, c, a){
  var ctr = P({x:c[0],y:c[1],z:c[2]});
  var axes = [[a[0],0,0],[0,a[1],0],[0,0,a[2]]], vecs = [];
  for (var i=0;i<3;i++){
    var e = P({x:c[0]+axes[i][0], y:c[1]+axes[i][1], z:c[2]+axes[i][2]});
    vecs.push({ dx:e.x-ctr.x, dy:e.y-ctr.y, len:Math.sqrt(Math.pow(e.x-ctr.x,2)+Math.pow(e.y-ctr.y,2)) });
  }
  vecs.sort(function(A,B){ return B.len-A.len });
  return { c:ctr, rx:vecs[0].len, ry:vecs[1].len, rot:Math.atan2(vecs[0].dy, vecs[0].dx), depth:ctr.depth };
}
function ellipseMarkup(E, attrs){
  return '<ellipse cx="'+E.c.x.toFixed(2)+'" cy="'+E.c.y.toFixed(2)+'" rx="'+Math.max(0.4,E.rx).toFixed(2)+'" ry="'+Math.max(0.4,E.ry).toFixed(2)+'"'
    + ' transform="rotate('+(E.rot*180/Math.PI).toFixed(1)+' '+E.c.x.toFixed(2)+' '+E.c.y.toFixed(2)+')" '+attrs+'/>';
}
function polyPath(ring){
  var d = '';
  for (var i=0;i<ring.length;i++) d += (i?' L':'M') + ring[i].x.toFixed(2) + ' ' + ring[i].y.toFixed(2);
  return d + ' Z';
}
function haloText(x, y, size, fill, text, opacity, weight){
  return '<text x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" text-anchor="middle" font-size="'+size.toFixed(2)+'"'+
    ' fill="'+fill+'" fill-opacity="'+(opacity==null?1:opacity)+'"'+(weight?' font-weight="'+weight+'"':'')+
    ' stroke="#0a0f15" stroke-width="'+(size*0.34).toFixed(2)+'" stroke-opacity="0.85" paint-order="stroke" stroke-linejoin="round">'+esc(text)+'</text>';
}
/* 血管走线：两点之间拱起，跨层越多拱得越高 */
function vesselPoints(a,b,n,span){
  var mx=(a.x+b.x)/2, my=(a.y+b.y)/2, mz=(a.z+b.z)/2;
  var spread = Math.sqrt(Math.pow(b.x-a.x,2)+Math.pow(b.z-a.z,2));
  var ctrl = { x:mx, y:Math.max(a.y,b.y) + 0.4 + spread*0.10 + (span||0)*0.4, z:mz };
  var out = [];
  for (var i=0;i<=n;i++){
    var t=i/n, u=1-t;
    out.push({ x:u*u*a.x+2*u*t*ctrl.x+t*t*b.x, y:u*u*a.y+2*u*t*ctrl.y+t*t*b.y, z:u*u*a.z+2*u*t*ctrl.z+t*t*b.z });
  }
  return out;
}
/* 每个器官按"它干的事"现场长出形状（返回若干 SVG 片段） */
function organelle(parts, kind, p, r, col, dim, U, outUnit){
  var o = outUnit || { x:0, y:-1 };
  U = U*0.55;                                  // 附属结构整体收细：小球时代不需要粗触须
  if (kind === 'sense'){                       // 感受器：几根朝外的触须
    for (var i=0;i<5;i++){
      var a = -Math.PI/2 + (i-2)*0.52;
      var ex = p.x + Math.cos(a)*r*2.4, ey = p.y + Math.sin(a)*r*2.4;
      parts.push('<line class="organelle-part" x1="'+p.x.toFixed(2)+'" y1="'+p.y.toFixed(2)+'" x2="'+ex.toFixed(2)+'" y2="'+ey.toFixed(2)+'" stroke="'+col+'" stroke-opacity="'+(dim?0.2:0.75)+'" stroke-width="'+(U*0.05).toFixed(2)+'" stroke-linecap="round"/>');
      parts.push('<circle class="organelle-part" cx="'+ex.toFixed(2)+'" cy="'+ey.toFixed(2)+'" r="'+(U*0.16).toFixed(2)+'" fill="'+col+'" fill-opacity="'+(dim?0.2:0.85)+'"/>');
    }
  } else if (kind === 'act'){                  // 效应器：朝外的粗短突起
    var ex2 = p.x + o.x*r*2.2, ey2 = p.y + o.y*r*2.2;
    parts.push('<line class="organelle-part" x1="'+p.x.toFixed(2)+'" y1="'+p.y.toFixed(2)+'" x2="'+ex2.toFixed(2)+'" y2="'+ey2.toFixed(2)+'" stroke="'+col+'" stroke-opacity="'+(dim?0.2:0.85)+'" stroke-width="'+(U*0.16).toFixed(2)+'" stroke-linecap="round"/>');
    parts.push('<circle class="organelle-part" cx="'+ex2.toFixed(2)+'" cy="'+ey2.toFixed(2)+'" r="'+(U*0.30).toFixed(2)+'" fill="'+col+'" fill-opacity="'+(dim?0.2:0.9)+'"/>');
  } else if (kind === 'route'){                // 接头：环面
    parts.push('<circle class="organelle-part" cx="'+p.x.toFixed(2)+'" cy="'+p.y.toFixed(2)+'" r="'+(r*1.55).toFixed(2)+'" fill="none" stroke="'+col+'" stroke-opacity="'+(dim?0.12:0.6)+'" stroke-width="'+(U*0.07).toFixed(2)+'"/>');
    parts.push('<circle class="organelle-part" cx="'+p.x.toFixed(2)+'" cy="'+p.y.toFixed(2)+'" r="'+(r*0.75).toFixed(2)+'" fill="none" stroke="'+col+'" stroke-opacity="'+(dim?0.12:0.5)+'" stroke-width="'+(U*0.05).toFixed(2)+'"/>');
  } else if (kind === 'store'){                // 囊：椭球加两条箍
    parts.push(ellipseMarkup({ c:{x:p.x,y:p.y}, rx:r*1.25, ry:r*1.85, rot:0.35, depth:0 },
      'class="organelle-part" fill="none" stroke="'+col+'" stroke-opacity="'+(dim?0.14:0.65)+'" stroke-width="'+(U*0.05).toFixed(2)+'"'));
    parts.push('<line class="organelle-part" x1="'+(p.x-r*1.1).toFixed(2)+'" y1="'+(p.y-r*0.5).toFixed(2)+'" x2="'+(p.x+r*1.1).toFixed(2)+'" y2="'+(p.y+r*0.5).toFixed(2)+'" stroke="'+col+'" stroke-opacity="'+(dim?0.12:0.5)+'" stroke-width="'+(U*0.04).toFixed(2)+'"/>');
  } else if (kind === 'govern'){               // 鞘：外套环
    parts.push('<circle class="organelle-part" cx="'+p.x.toFixed(2)+'" cy="'+p.y.toFixed(2)+'" r="'+(r*2.05).toFixed(2)+'" fill="none" stroke="'+col+'" stroke-opacity="'+(dim?0.12:0.42)+'" stroke-width="'+(U*0.03).toFixed(2)+'"/>');
  } else if (kind === 'report'){               // 发射器：锥＋短杆
    var tipX = p.x + o.x*r*1.9, tipY = p.y + o.y*r*1.9;
    parts.push('<line class="organelle-part" x1="'+p.x.toFixed(2)+'" y1="'+p.y.toFixed(2)+'" x2="'+tipX.toFixed(2)+'" y2="'+tipY.toFixed(2)+'" stroke="'+col+'" stroke-opacity="'+(dim?0.18:0.8)+'" stroke-width="'+(U*0.07).toFixed(2)+'"/>');
    parts.push('<path class="organelle-part" d="M'+(tipX- U*0.28).toFixed(2)+' '+(tipY+U*0.30).toFixed(2)+' L'+tipX.toFixed(2)+' '+tipY.toFixed(2)+' L'+(tipX+U*0.28).toFixed(2)+' '+(tipY+U*0.30).toFixed(2)+' Z" fill="'+col+'" fill-opacity="'+(dim?0.2:0.85)+'"/>');
  } else if (kind === 'adapt'){                // 适配：叶状小叶
    for (var k2=0;k2<4;k2++){
      var aa = -Math.PI/2 + k2*Math.PI/2;
      parts.push(ellipseMarkup({ c:{ x:p.x+Math.cos(aa)*r*1.4, y:p.y+Math.sin(aa)*r*1.4 }, rx:r*0.6, ry:r*0.28, rot:aa, depth:0 },
        'class="organelle-part" fill="'+col+'" fill-opacity="'+(dim?0.12:0.45)+'"/>'));
    }
  } else {                                     // 判断：内核（内环）
    parts.push('<circle class="organelle-part" cx="'+p.x.toFixed(2)+'" cy="'+p.y.toFixed(2)+'" r="'+(r*0.62).toFixed(2)+'" fill="none" stroke="'+col+'" stroke-opacity="'+(dim?0.15:0.7)+'" stroke-width="'+(U*0.06).toFixed(2)+'"/>');
  }
}

function draw3d(){
  var svg = document.getElementById('chart3d');
  if (!svg) return;
  var sc = scene(), P0 = projector(sc);
  var depth = depth3d();
  var rank = sc.rank;

  var half = sc.rad * 0.62;      // 取景更紧：默认就把身体画大（原 0.80 太"扣搜"）
  var vb = [-half, -half, half*2, half*2];
  var P = function(p){
    var q = P0(p);
    q.x = (q.x * view.k) + view.x;
    q.y = (q.y * view.k) + view.y;
    return q;
  };
  var U = (half*2)/34;
  var Z = Math.max(1, Math.min(view.k, 1.8));

  var items=[], chipBoxes=[];
  /* 拾取表每帧清空"内容"而不是换数组：外部（工具/测试）持有的引用一直有效 */
  pickCache.length = 0; flowPick.length = 0; regionPick.length = 0;
  function put(depthv, markup){ items.push({ depth:depthv, svg:markup }); }

  var selOrgan = state.sel && state.sel.kind==='organ' ? state.sel.id : null;
  var selFlow  = state.sel && state.sel.kind==='flow'  ? state.sel.id : null;
  function neighbours(id){
    var set={}; if (!id) return set;
    set[id]=true;
    for (var r=0;r<FLOWS().length;r++){ var fl=FLOWS()[r]; if (fl.from===id||fl.to===id){ set[fl.from]=true; set[fl.to]=true; } }
    return set;
  }
  var anchorId = state.hover || selOrgan;
  var related = neighbours(anchorId);
  var labelMode = state.labels || 'focus';
  var focusSet = null;
  if (state.isolate){
    focusSet = {};
    for (var fi=0;fi<ORGANS().length;fi++){
      var oo=ORGANS()[fi];
      if ((oo.systems||[]).indexOf(state.isolate)>=0) focusSet[oo.id]=true;
    }
  }
  var clumpFocus = state.regionFocus || null;
  function inFocus(o){
    return (!focusSet || focusSet[o.id] === true) && (!clumpFocus || rank.regionOf[o.id] === clumpFocus);
  }
  function matchQ(o){ if(!state.q) return true; var t=state.q.toLowerCase();
    return (o.name||'').toLowerCase().indexOf(t)>=0 || o.id.indexOf(t)>=0 || (o.gist||'').toLowerCase().indexOf(t)>=0; }

  /* ── ① 外膜：由这个工程的实际形状拟合出来的椭球 + 经线纬线 ───────────── */
  if (depth <= 1){
    var M = sc.membrane, mc = [M.c.x, M.c.y, M.c.z], ma = M.a;
    var sil = projEllipsoid(P, mc, ma);
    /* 第一眼只给"一具完整的外形"：膜要真的挡视线（内部一概不画），人自己决定什么时候揭开 */
    put(sil.depth + sc.rad*1.6, ellipseMarkup(sil,
      'class="membrane" fill="url(#membraneGrad)" fill-opacity="0.94" stroke="#8fd0c8" stroke-opacity="0.55" stroke-width="'+(U*0.07).toFixed(2)+'"'));
    for (var li=-2; li<=2; li++){              // 纬线
      var yy = ma[1]*li/2.6, rr = Math.sqrt(Math.max(0.05, 1 - Math.pow(yy/ma[1],2)));
      var ring=[];
      for (var ti=0; ti<=48; ti++){
        var th = ti/48*Math.PI*2;
        ring.push(P({ x:mc[0]+Math.cos(th)*ma[0]*rr, y:mc[1]+yy, z:mc[2]+Math.sin(th)*ma[2]*rr }));
      }
      put(ring[0].depth + sc.rad*1.5, '<path class="membrane-line" d="'+polyPath(ring)+'" fill="none" stroke="#8fd0c8" stroke-opacity="0.10" stroke-width="'+(U*0.03).toFixed(2)+'"/>');
    }
    for (var mi=0; mi<8; mi++){                // 经线
      var mth = mi/8*Math.PI*2, arc=[];
      for (var si2=0; si2<=24; si2++){
        var ph = si2/24*Math.PI;
        arc.push(P({ x:mc[0]+Math.cos(mth)*Math.sin(ph)*ma[0], y:mc[1]+Math.cos(ph)*ma[1], z:mc[2]+Math.sin(mth)*Math.sin(ph)*ma[2] }));
      }
      var dA=''; for (var ai2=0;ai2<arc.length;ai2++) dA += (ai2?' L':'M') + arc[ai2].x.toFixed(2)+' '+arc[ai2].y.toFixed(2);
      put(arc[Math.floor(arc.length/2)].depth + sc.rad*1.4, '<path class="membrane-line" d="'+dA+'" fill="none" stroke="#8fd0c8" stroke-opacity="0.10" stroke-width="'+(U*0.03).toFixed(2)+'"/>');
    }
  }

  /* ── 脉络：数据流动与交换。深度 4 时是主角 ─────────────────────────── */
  var flowAlpha = depth>=4 ? 0.95 : (depth===3 ? 0.30 : 0.10);
  for (var f2=0; depth>=2 && f2<FLOWS().length;f2++){
    var flow=FLOWS()[f2];
    if (state.mediaOff[flow.medium]===true) continue;
    var pa=sc.pos[flow.from], pb=sc.pos[flow.to];
    if (!pa||!pb) continue;
    var on = selFlow===flow.id || (anchorId && (flow.from===anchorId||flow.to===anchorId));
    var dim = (selFlow && !on) || (!!anchorId && !on)
              || !!(focusSet && !(inFocus(organById(flow.from)||{}) && inFocus(organById(flow.to)||{})))
              || !!(clumpFocus && !on && !(rank.regionOf[flow.from]===clumpFocus || rank.regionOf[flow.to]===clumpFocus));
    var base = mediumColor(flow.medium);
    var span = Math.abs((rank.layerOf[flow.from]||0) - (rank.layerOf[flow.to]||0));
    var proj = vesselPoints(pa,pb,16,span).map(P);
    var thick = 1 + 0.30*Math.min(4, (flow.payload||[]).length);     // 载荷越多略粗一点（原先放到 3.2 倍太粗）
    for (var sg=0; sg<proj.length-1; sg++){
      var s0=proj[sg], s1=proj[sg+1];
      var w = U*(on?0.115:0.05)*thick*(depth>=4?1.2:1)*view.k;     // 连线整体细化
      var op = on ? 1 : (dim ? 0.05 : flowAlpha);
      put((s0.depth+s1.depth)/2, '<line class="f3'+(on?' on':'')+'" x1="'+s0.x.toFixed(2)+'" y1="'+s0.y.toFixed(2)+'" x2="'+s1.x.toFixed(2)+'" y2="'+s1.y.toFixed(2)+'" stroke="'+base+'" stroke-width="'+w.toFixed(3)+'" stroke-opacity="'+op+'" stroke-linecap="round"/>');
      if (sg % 4 === 2 && !dim) flowPick.push({ id:flow.id, vx:(s0.x+s1.x)/2, vy:(s0.y+s1.y)/2, depth:(s0.depth+s1.depth)/2 });
    }
    /* 方向：中点一个小箭头（数据往哪流） */
    if (!dim){
      var m1 = proj[Math.floor(proj.length*0.55)], m0 = proj[Math.floor(proj.length*0.45)];
      var angA = Math.atan2(m1.y-m0.y, m1.x-m0.x);
      put((m1.depth+m0.depth)/2 - sc.rad*0.1,
        '<path class="flow-arrow" d="M'+(m1.x - Math.cos(angA-0.42)*U*0.30).toFixed(2)+' '+(m1.y - Math.sin(angA-0.42)*U*0.30).toFixed(2)
        +' L'+m1.x.toFixed(2)+' '+m1.y.toFixed(2)+' L'+(m1.x - Math.cos(angA+0.42)*U*0.30).toFixed(2)+' '+(m1.y - Math.sin(angA+0.42)*U*0.30).toFixed(2)
        +' Z" fill="'+base+'" fill-opacity="'+(on?1:0.55)+'"/>');
    }
    if(flow.direction==='two-way' && !dim){
      var back=proj[5], beforeBack=proj[7], ba=Math.atan2(back.y-beforeBack.y,back.x-beforeBack.x), ar=U*0.30;
      put(back.depth,'<path class="flow-arrow reverse" d="M'+(back.x-Math.cos(ba-0.42)*ar)+' '+(back.y-Math.sin(ba-0.42)*ar)+' L'+back.x+' '+back.y+' L'+(back.x-Math.cos(ba+0.42)*ar)+' '+(back.y-Math.sin(ba+0.42)*ar)+' Z" fill="'+base+'"/>');
    }
    if (on && depth>=2){
      var mid2=proj[Math.floor(proj.length/2)];
      /* 脉络上的字：只写名字（物质名去侧栏看），沿血管方向贴在线身上 */
      var mi = Math.floor(proj.length/2), midA = proj[mi], prvA = proj[Math.max(0, mi-2)];
      var angA = Math.atan2(midA.y-prvA.y, midA.x-prvA.x);
      if (angA > Math.PI/2) angA -= Math.PI;
      if (angA < -Math.PI/2) angA += Math.PI;
      var txtA = (flow.name || '数据传递') + (flow.timing ? ' · '+flow.timing.latencyMs+'毫秒' : ' · 耗时未知'), fsA = U*0.62*Z;
      /* 字只写名字（免得线上挤成一团），但悬停要给全：这管血送的是什么物质 */
      var tipA = txtA + ' · ' + timingText(flow) + (state.mode==='agent' && flow.vessel ? ' · ' + flow.vessel : '');
      put(midA.depth-1, '<text x="'+midA.x.toFixed(2)+'" y="'+(midA.y-U*0.30).toFixed(2)+'" transform="rotate('+(angA*180/Math.PI).toFixed(1)+' '+midA.x.toFixed(2)+' '+midA.y.toFixed(2)+')" text-anchor="middle" font-size="'+fsA.toFixed(2)+'" textLength="'+Math.min(3.2*U, txtA.length*fsA).toFixed(2)+'" lengthAdjust="spacingAndGlyphs" fill="'+base+'" font-weight="600" stroke="#0a0f15" stroke-width="'+(fsA*0.30).toFixed(2)+'" stroke-opacity="0.85" paint-order="stroke" stroke-linejoin="round">'+esc(txtA)+'<title>'+esc(tipA)+'</title></text>');
    }
  }

  /* ── 器官：形状即职能 ─────────────────────────────────────────────── */
  var organOp = (depth===2 ? 1 : (depth===3 ? 0.72 : 0.40));
  var minDepth = 1e9, maxDepth = -1e9;
  var info = {}, order = [];
  var ctr = P({ x:sc.center.x, y:sc.center.y, z:sc.center.z });
  for (var n2=0;n2<ORGANS().length;n2++){
    var organ=ORGANS()[n2], wp2=sc.pos[organ.id];
    if (!wp2) continue;
    var p=P(wp2);
    var en = { p:p, id:organ.id, organ:organ, imp: rank.impOf[organ.id]||0,
               kind: rank.kindOf[organ.id], layer: rank.layerOf[organ.id]||0,
               dim2: !matchQ(organ) || !inFocus(organ) || (!!anchorId && !related[organ.id]),
               isOn: anchorId===organ.id };
    en.wantLabel = labelMode==='all' ? true : (labelMode==='off' ? false : !!related[organ.id]);
    /* 球的大小＝名字要装得下（显示名字时）／重要程度（不显示时）。
       世界半径 → 屏幕：用同一个投影比例，和间距同一套尺度，布局给名字留的位置才作数。 */
    en.rWorld = organDrawR(organ, en.imp, true);
    en.r = en.rWorld * p.f * view.k * (en.isOn?1.12:1);
    en.full = String(organ.name||organ.id);                 // 全名：给悬停提示与侧栏
    en.label = en.full.length > 5 ? en.full.slice(0,4)+'…' : en.full;   // 球内只写短名，字才够大
    en.anchor = { x:p.x, y:p.y };                       // 引线的另一端：器官本身
    en.ang = Math.atan2(p.y-ctr.y, p.x-ctr.x);          // 按角度排到外侧一圈上
    var ddx=p.x-ctr.x, ddy=p.y-ctr.y, dl=Math.sqrt(ddx*ddx+ddy*ddy)||1;
    en.dirx = ddx/dl; en.diry = ddy/dl;
    en.halfW = Math.max(U*0.9, en.label.length*U*0.33);
    en.shown = false;
    /* 接口器官：朝膜外推一点，看起来是"穿出外膜"的 */
    if (en.layer === 0){
      var dirx = p.x-ctr.x, diry=p.y-ctr.y, dl2=Math.sqrt(dirx*dirx+diry*diry)||1;
      p.x += dirx/dl2*U*1.2; p.y += diry/dl2*U*1.2;
      en.p = p;
    }
    info[organ.id] = en; order.push(en);
  }
  for (var di=0; di<order.length; di++){
    minDepth = Math.min(minDepth, order[di].p.depth);
    maxDepth = Math.max(maxDepth, order[di].p.depth);
  }
  /* ── 文字统一挂到身体外侧的一圈上，用引线指回器官 ─────────────────────
     这样文字永远不压在图上；同一侧的角度不够时，按重要性让位（放不下的不显示）。 */
  var sil0 = projEllipsoid(P, [sc.membrane.c.x, sc.membrane.c.y, sc.membrane.c.z], sc.membrane.a);
  var ringR = function(dx, dy){
    /* 沿这个方向，椭球边缘在屏幕上离中心多远（把方向转进椭圆自己的坐标系算） */
    var ca = Math.cos(-sil0.rot), sa = Math.sin(-sil0.rot);
    var ux2 = dx*ca - dy*sa, uy2 = dx*sa + dy*ca;
    var rx = Math.max(1, sil0.rx), ry = Math.max(1, sil0.ry);
    var k2 = Math.sqrt((ux2*ux2)/(rx*rx) + (uy2*uy2)/(ry*ry)) || 1;
    return 1/Math.max(0.0001, k2);
  };
  var labelBoxes = [];
  function placeLabels(list){
    for (var i2=0;i2<list.length;i2++){
      var e4=list[i2];
      var dirx = e4.dirx, diry = e4.diry;
      if (!isFinite(dirx) || !isFinite(diry) || (dirx===0 && diry===0)){ dirx = 1; diry = 0; }
      var rr3 = ringR(dirx, diry) * 1.10;                 // 挂到膜外 10% 处
      var side = dirx >= 0 ? 1 : -1;
      var lx = ctr.x + dirx*rr3 + side*U*0.35;
      var ly = ctr.y + diry*rr3 + U*0.35;
      e4.lx = lx; e4.ly = ly; e4.side = side;
      e4.box = { x0: side>0 ? lx-U*0.2 : lx-e4.halfW*2-U*0.2, x1: side>0 ? lx+e4.halfW*2+U*0.2 : lx+U*0.2,
                 y0: ly-U*0.85, y1: ly+U*0.45 };
    }
    /* 同侧按 x 排序，做一次"水平不重叠"推挤；推不动就不显示（宁缺勿乱） */
    list.sort(function(a,b){ return a.ly-b.ly || a.lx-b.lx });
    var top = list.filter(function(e){ return e.diry < 0 }), bot = list.filter(function(e){ return e.diry >= 0 });
    [top, bot].forEach(function(group){
      group.sort(function(a,b){ return a.lx-b.lx });
      var lastX = -1e9, lastY = -1e9;
      for (var g=0;g<group.length;g++){
        var e5b = group[g], w2 = e5b.box.x1-e5b.box.x0;
        var need = e5b.box.x0 - lastX;
        if (need < 0){ e5b.lx -= need; e5b.box.x0 -= need; e5b.box.x1 -= need; }
        var dy2 = Math.abs(e5b.ly - lastY);
        if (e5b.box.x0 < lastX + U*0.3 && dy2 < U*1.05){ e5b.shown = false; }   // 挤不下就不显示
        else { e5b.shown = true; }
        lastX = e5b.box.x1; lastY = e5b.ly;
      }
    });
  }
  /* 名字画在球里面：显示名字的球会按名字撑大，不显示的保持小球 */
  for (var t6=0;t6<order.length;t6++){
    var e6 = order[t6];
    if (labelMode==='off'){ e6.shown = false; continue; }
    e6.shown = !!(e6.isOn || (!e6.dim2 && e6.wantLabel));
    e6.r = organDrawR(e6.organ, e6.imp, e6.shown) * P(e6.organ ? sc.pos[e6.organ.id] : {x:0,y:0,z:0}).f * view.k * (e6.isOn?1.12:1);
    e6.box = { x0: e6.p.x-e6.r, x1: e6.p.x+e6.r, y0: e6.p.y-e6.r, y1: e6.p.y+e6.r };
  }
  for (var n3=0; depth>=2 && n3<ORGANS().length;n3++){
    var organ2=ORGANS()[n3], en2=info[organ2.id];
    if (!en2) continue;
    var primary=(organ2.systems||[])[0], col2=systemColor(primary);
    var p2=en2.p, r2=en2.r, dim4=en2.dim2, isOn2=en2.isOn;
    var bgDim = depth>=4 && !isOn2;
    var parts=[];
    var outUnit = { x:(p2.x-ctr.x), y:(p2.y-ctr.y) };
    var ol = Math.sqrt(outUnit.x*outUnit.x + outUnit.y*outUnit.y)||1;
    outUnit = { x:outUnit.x/ol, y:outUnit.y/ol };
    /* ③ 骨架：成分节点 + 契约环 */
    if (depth>=3 && !dim4 && !bgDim){
      var comp = organ2.composition || [];
      for (var ci=0; ci<comp.length && ci<7; ci++){
        var ca = -Math.PI/2 + (ci/Math.max(1,comp.length))*Math.PI*2;
        var cx2 = p2.x + Math.cos(ca)*r2*1.85, cy2 = p2.y + Math.sin(ca)*r2*1.85*0.7;
        parts.push('<line x1="'+p2.x.toFixed(2)+'" y1="'+p2.y.toFixed(2)+'" x2="'+cx2.toFixed(2)+'" y2="'+cy2.toFixed(2)+'" stroke="'+col2+'" stroke-opacity="0.34" stroke-width="'+(U*0.03).toFixed(3)+'"/>');
        parts.push('<circle class="bone comp" cx="'+cx2.toFixed(2)+'" cy="'+cy2.toFixed(2)+'" r="'+(U*0.28).toFixed(2)+'" fill="'+col2+'" fill-opacity="0.6" stroke="#0a0f15" stroke-width="'+(U*0.028).toFixed(2)+'"/>');
      }
      var cv = organ2.contract || {};
      var ninv = (cv.in||[]).length + (cv.out||[]).length + (cv.invariants||[]).length;
      if (ninv){
        parts.push('<circle class="bone ring" cx="'+p2.x.toFixed(2)+'" cy="'+p2.y.toFixed(2)+'" r="'+(r2*(1.5 + Math.min(4,ninv)*0.16)).toFixed(2)+'" fill="none" stroke="#eae0cc" stroke-opacity="0.38" stroke-width="'+(U*0.026).toFixed(3)+'"/>');
      }
    }
    /* 深度线索：投影越靠后（depth 越大）越暗一点，前后遮挡时也能一眼分清谁在前面 */
    var depthFade = 1 - clampNum((p2.depth - minDepth) / Math.max(1, (maxDepth - minDepth)), 0, 1) * 0.45;
    parts.push('<circle class="organelle kind-'+esc(en2.kind)+'" cx="'+p2.x.toFixed(2)+'" cy="'+p2.y.toFixed(2)+'" r="'+r2.toFixed(2)+'" fill="url(#sphere-'+esc(primary)+')" fill-opacity="'+((dim4?0.12:(bgDim?0.4:organOp))*depthFade).toFixed(2)+'"/>');
    parts.push('<circle cx="'+p2.x.toFixed(2)+'" cy="'+p2.y.toFixed(2)+'" r="'+r2.toFixed(2)+'" fill="none" stroke="'+col2+'" stroke-opacity="'+(dim4?0.1:(bgDim?0.4:0.9)).toFixed(2)+'" stroke-width="'+(U*(isOn2?0.12:0.05)).toFixed(3)+'"/>');
    organelle(parts, en2.kind, p2, r2, col2, dim4 || bgDim, U, outUnit);   // 形状＝职能
    var extra=(organ2.systems||[]).slice(1);
    for (var e4=0;e4<extra.length;e4++){
      parts.push('<circle cx="'+p2.x.toFixed(2)+'" cy="'+p2.y.toFixed(2)+'" r="'+(r2*(1.45+e4*0.4)).toFixed(2)+'" fill="none" stroke="'+systemColor(extra[e4])+'" stroke-opacity="'+(dim4?0.06:0.34).toFixed(2)+'" stroke-width="'+(U*0.045).toFixed(3)+'"/>');
    }
    if (isOn2) parts.push('<circle cx="'+p2.x.toFixed(2)+'" cy="'+p2.y.toFixed(2)+'" r="'+(r2*2.2).toFixed(2)+'" fill="none" stroke="#63e6ff" stroke-opacity="0.4" stroke-width="'+(U*0.07).toFixed(3)+'"/>');
    if (en2.shown){
      /* 名字写在球里（居中），按球的大小缩放字号，短名字不会变成一个大空球 */
      /* 字要"浓缩"在圈里：宽 = 字数×字号 ≤ 1.75×半径，行高 ≤ 0.9×半径 */
      var fs = Math.min(en2.r*0.95, (2.6*en2.r)/Math.max(2, en2.label.length));
      parts.push('<text x="'+p2.x.toFixed(2)+'" y="'+(p2.y+fs*0.35).toFixed(2)+'" text-anchor="middle" font-size="'+fs.toFixed(2)+'" textLength="'+Math.min(1.72*en2.r, en2.label.length*fs).toFixed(2)+'" lengthAdjust="spacingAndGlyphs" fill="#f2f7fc" fill-opacity="'+(dim4?0.35:1)+'" font-weight="600" stroke="#0a0f15" stroke-width="'+(fs*0.28).toFixed(2)+'" stroke-opacity="0.8" paint-order="stroke" stroke-linejoin="round">'+esc(en2.label)+'<title>'+esc(en2.full||en2.label)+'</title></text>');
    }
    put(p2.depth - (isOn2?3:0.02), parts.join(''));
  }

  /* ── 器官群标签：点它只看这一群 ───────────────────────────────────── */
  /* 器官群：也做成"圈里写字"的泡泡（不再是外圈散字）——沿外圈均匀排开，圈径按字数定 */
  var bubbles = [];
  for (var cp=0; false && cp<sc.clumpPick.length; cp++){   // 群名改由 HTML 小列表显示，画布上不再画
    var C = sc.clumpPick[cp], lp = P({ x:C.x, y:C.y, z:C.z });
    var text = C.name + '（' + C.count + '）';
    var fs = U*0.85*Z;
    var rr4 = Math.max(U*1.15, text.length*fs*0.55 + U*0.5);       // 装得下这行字
    bubbles.push({ C:C, lp:lp, text:text, fs:fs, r:rr4, ang:Math.atan2(lp.y-ctr.y, lp.x-ctr.x) });
  }
  /* 按角度排开，圆与圆之间留缝：不够就沿外圈推开 */
  bubbles.sort(function(a,b){ return a.ang-b.ang });
  for (var bp=0; bp<bubbles.length; bp++){
    var cur = bubbles[bp], nxt = bubbles[(bp+1) % bubbles.length];
    if (bubbles.length < 2) break;
    var dx2 = nxt.lp.x-cur.lp.x, dy2 = nxt.lp.y-cur.lp.y;
    var d2 = Math.sqrt(dx2*dx2+dy2*dy2) || 0.001;
    var need2 = cur.r + nxt.r + U*0.5;
    if (d2 < need2){
      var push4 = (need2-d2)*0.5, ux4 = dx2/d2, uy4 = dy2/d2;
      cur.lp.x -= ux4*push4; cur.lp.y -= uy4*push4;
      nxt.lp.x += ux4*push4; nxt.lp.y += uy4*push4;
    }
  }
  for (var bp2=0; bp2<bubbles.length; bp2++){
    var B = bubbles[bp2], hot = clumpFocus===B.C.id, dimC = (clumpFocus && !hot);
    var col3 = systemColor(B.C.id);
    regionPick.push({ region:B.C.id, x:B.lp.x, y:B.lp.y, hit:Math.max(B.r, U*1.4) });
    var inner = Math.min(B.fs, (1.75*B.r)/Math.max(2, B.text.length));
    var parts2 = [];
    /* 引一根细线到本群的位置，表明这个圈代表哪一片 */
    parts2.push('<line x1="'+B.lp.x.toFixed(2)+'" y1="'+B.lp.y.toFixed(2)+'" x2="'+P({x:B.C.x,y:B.C.y,z:B.C.z}).x.toFixed(2)+'" y2="'+P({x:B.C.x,y:B.C.y,z:B.C.z}).y.toFixed(2)+'" stroke="'+col3+'" stroke-opacity="0.22" stroke-width="'+(U*0.025).toFixed(3)+'"/>');
    parts2.push('<circle cx="'+B.lp.x.toFixed(2)+'" cy="'+B.lp.y.toFixed(2)+'" r="'+B.r.toFixed(2)+'" fill="'+(hot?col3:'#0b1118')+'" fill-opacity="'+(hot?0.28:0.55)+'" stroke="'+col3+'" stroke-opacity="'+(hot?0.95:0.45)+'" stroke-width="'+(U*0.05).toFixed(2)+'"/>');
    parts2.push('<text x="'+B.lp.x.toFixed(2)+'" y="'+(B.lp.y+inner*0.35).toFixed(2)+'" text-anchor="middle" font-size="'+inner.toFixed(2)+'" fill="'+col3+'" fill-opacity="'+(dimC?0.5:1)+'" font-weight="600" stroke="#0a0f15" stroke-width="'+(inner*0.26).toFixed(2)+'" stroke-opacity="0.75" paint-order="stroke" stroke-linejoin="round">'+esc(B.text)+'</text>');
    put(B.lp.depth - sc.rad*1.0, '<g class="regionlabel" data-region="'+esc(B.C.id)+'" style="cursor:pointer'+(dimC?';opacity:.4':'')+'">'+parts2.join('')+'</g>');
  }

  var defs='<defs><radialGradient id="membraneGrad" cx="34%" cy="26%" r="78%">'
    + '<stop offset="0%" stop-color="#bfe9e2" stop-opacity="0.30"/>'
    + '<stop offset="58%" stop-color="#7fc4bd" stop-opacity="0.16"/>'
    + '<stop offset="100%" stop-color="#0b1118" stop-opacity="0.10"/></radialGradient>';
  for (var s4=0;s4<(BODY().systems||[]).length;s4++){
    var sid=(BODY().systems[s4]||{}).id, sc4=systemColor(sid);
    defs += '<radialGradient id="sphere-'+esc(sid)+'" cx="34%" cy="28%" r="72%">'
          + '<stop offset="0%" stop-color="'+sc4+'" stop-opacity="0.95"/>'
          + '<stop offset="62%" stop-color="'+sc4+'" stop-opacity="0.42"/>'
          + '<stop offset="100%" stop-color="#0b1118" stop-opacity="0.92"/></radialGradient>';
  }
  defs += '</defs>';
  items.sort(function(a,b){ return b.depth-a.depth; });
  svg.setAttribute('viewBox', vb.map(function(v){return v.toFixed(2)}).join(' '));
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  svg.innerHTML = defs + items.map(function(it){ return it.svg; }).join('');

  var box = svg.getBoundingClientRect();
  var k = Math.min(box.width ? box.width/vb[2] : 1, box.height ? box.height/vb[3] : 1);
  var offX = (box.width - vb[2]*k)/2, offY = (box.height - vb[3]*k)/2;
  for (var q3=0; depth>=2 && q3<ORGANS().length;q3++){
    var op=ORGANS()[q3], wq=sc.pos[op.id], e5=info[op.id];
    if (!wq || !e5) continue;
    var pp=P(wq);
    pickCache.push({ id:op.id, r:e5.r*k, x:(pp.x-vb[0])*k+offX, y:(pp.y-vb[1])*k+offY, hit:Math.max(12, e5.r*k*1.6), depth:pp.depth,
                     region:e5.region||rank.regionOf[op.id], kind:e5.kind, layer:e5.layer, importance:e5.imp });
  }
  for (var fp=0; fp<flowPick.length; fp++){
    var f5=flowPick[fp];
    f5.x = (f5.vx-vb[0])*k+offX; f5.y = (f5.vy-vb[1])*k+offY; f5.hit = Math.max(9, U*k*0.85);
  }
  for (var rp=0; rp<regionPick.length; rp++){
    var r5=regionPick[rp];
    r5.x = (r5.x-vb[0])*k+offX; r5.y = (r5.y-vb[1])*k+offY;
  }
  if (typeof window !== 'undefined' && window){
    /* 保持同一个对象：外部工具与无头测试拿到的引用不会因为重画而失效 */
    var hook = window.__anatomy || (window.__anatomy = {});
    hook.pickCache = pickCache; hook.flowPick = flowPick; hook.regionPick = regionPick;
    hook.vb = vb; hook.state = state; hook.cam = cam; hook.view = view;
    hook.scale = k; hook.offX = offX; hook.offY = offY;
    hook.scene = sc; hook.depth = depth; hook.membrane = sc.membrane;
    hook.rank = { layerOf:rank.layerOf, regionOf:rank.regionOf, kindOf:rank.kindOf, impOf:rank.impOf, maxLayer:rank.maxLayer };
    hook.labelBoxes = (function(){ var out=[]; for (var kk in info){ var e=info[kk]; if (e && e.shown && e.box) out.push({ id:kk, box:e.box }); } return out; })();
  }
}
