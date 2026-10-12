import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anatomyFingerprint } from './store.js'

/**
 * 单文件解剖图。
 *
 * 同一张图上住着两个读者：
 *   👤 人读模式：只留器官名、一句话、血往哪流、它不负责什么；
 *   🤖 机读模式：追加成分、契约、可观测点与锚点。
 * 切换只改一个 CSS class——两个读者看的是同一份事实，不是两份文档。
 */
const clientDir = dirname(fileURLToPath(import.meta.url))
const CLIENT_3D = readFileSync(join(clientDir, 'chart-3d.js'), 'utf8')
const CLIENT_2D = readFileSync(join(clientDir, 'chart-client.js'), 'utf8')
// 立体引擎在前、平面与交互在后：同一个脚本作用域，函数声明会提升，末尾的 render() 最后执行。
const CLIENT_MAPPING = readFileSync(join(clientDir, 'mapping.js'), 'utf8').replace(/^export /gm, '')
const CLIENT_SEMANTICS = readFileSync(join(clientDir, 'semantics.js'), 'utf8').replace(/^export /gm, '')
const CLIENT = CLIENT_SEMANTICS + '\n' + CLIENT_MAPPING + '\n' + CLIENT_3D + '\n' + CLIENT_2D

export function renderAnatomy(body, organs, flows, options = {}) {
  const payload = {
    anatomyHash: anatomyFingerprint(body, organs, flows),
    implementation: options.implementation ?? null,
    body,
    organs,
    flows,
    lang: options.lang === 'en' ? 'en' : 'zh',
    banner: options.banner ?? null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  }
  // 防止数据里的 </script> 提前闭合脚本块，同时保留可读 JSON。
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  // 函数式替换：标题含 $' 或 $& 时，字符串替换会把整份模板插进 <title>，脚本被挤进 head，整页失效
  return TEMPLATE.replace('__TITLE__', () => escapeHtml(body.title ?? body.slug ?? 'ANATOMY'))
    .replace('__PAYLOAD__', json)
    // 用函数式替换：JSON 里的 $ 不会被当成替换模式；占位符在客户端脚本里，所以在这里注入
    .replace('/*__CLIENT__*/', () => CLIENT.replace('__PAYLOAD__', () => json))
}

export function writeAnatomyHtml(dir, html, outFile = 'anatomy.html') {
  const file = join(dir, outFile)
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html, 'utf8')
  return file
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

const TEMPLATE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ · 解剖图</title>
<style>
  :root{
    --ground:#0a0e13; --plate:#111820; --plate-2:#0e141b; --line:#20303f; --line-soft:#17222d;
    --ink:#e8eef6; --ink-2:#9fb0c2; --ink-3:#6b7f93; --accent:#63e6ff; --warn:#ffb454;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  .banner{display:none;background:#3a1414;border-bottom:1px solid #7a2a2a;color:#ffb9b9;padding:9px 20px;font-size:12.5px;letter-spacing:.2px}
  body{
    background:radial-gradient(1200px 700px at 18% -10%,#13202c 0%,var(--ground) 60%);
    color:var(--ink); font:14px/1.6 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    display:flex; flex-direction:column;
  }
  header{display:flex; gap:18px; align-items:flex-start; padding:16px 20px; border-bottom:1px solid var(--line-soft)}
  .headline{flex:1; min-width:0}
  h1{margin:0 0 4px; font-size:19px; letter-spacing:.4px}
  .oneline{margin:0; color:var(--ink-2); font-size:14px}
  .vitals{margin-top:6px; color:var(--ink-3); font-size:12px}
  .vitals b{color:var(--ink-2); font-weight:600}
  .controls{display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end}
  .seg{display:flex; border:1px solid var(--line); border-radius:9px; overflow:hidden; background:var(--plate-2)}
  .seg button{background:none; border:0; color:var(--ink-2); padding:7px 12px; cursor:pointer; font:inherit; font-size:13px;
    transition:none; outline:none; -webkit-tap-highlight-color:transparent}
  .seg button+button{border-left:1px solid var(--line)}
  .seg button:hover{background:#16222e; color:var(--ink)}
  /* 选中态要"亮着不动"：强调色描边 + 更亮的底，不用动画，避免闪烁 */
  .seg button[aria-pressed="true"]{background:#1d3346; color:#eaf6ff; font-weight:600;
    box-shadow:inset 0 0 0 1px rgba(99,230,255,.85), 0 0 10px rgba(99,230,255,.18)}
  .seg button[aria-pressed="true"]:hover{background:#224055}
  input[type=search]{
    background:var(--plate-2); border:1px solid var(--line); border-radius:9px; color:var(--ink);
    padding:7px 11px; font:inherit; font-size:13px; width:210px;
  }
  main{flex:1; display:flex; min-height:0}
  .stage{flex:1; min-width:0; display:flex; gap:12px; padding:12px 16px 22px; overflow:hidden; align-items:stretch}
  .pane{position:relative; flex:1 1 0; min-width:0; min-height:540px; border:1px solid var(--line-soft); border-radius:14px; background:linear-gradient(180deg,#0c131a,#0a1017); overflow:hidden; overscroll-behavior:contain}
  #chart{width:100%; height:100%; touch-action:none; cursor:grab}
  #chart.dragging{cursor:grabbing}
  .pane-tag{position:absolute; left:12px; top:9px; z-index:3; display:flex; gap:10px; align-items:center; font-size:11.5px; letter-spacing:1.6px; color:var(--ink-3); pointer-events:none}
  .pane-tag .hint{letter-spacing:0; font-size:11px; color:#3d5468}
  .pane-tag button{pointer-events:auto; background:#152230; border:1px solid var(--line); color:var(--ink-2); border-radius:7px; padding:2px 9px; font:inherit; font-size:11.5px; cursor:pointer}
  .pane-tag .tools{display:flex; gap:5px; margin-left:6px}
  .pane-tag .tools button:hover{border-color:#3a5b74; color:var(--ink)}
  #zoom-in,#zoom-out{min-width:26px; font-size:13px; line-height:1.1}
  .pane-tag button[aria-pressed="true"]{background:#1d3346; color:var(--ink)}
  #chart3d{display:block; width:100%; height:100%; touch-action:none; cursor:grab}
  #chart3d.dragging{cursor:grabbing}
  body.view-2d #pane-3d{display:none}
  body.view-3d #pane-2d{display:none}
  body.view-both aside{width:336px}
  body.view-both #pane-2d{flex:1 1 0}
  body.view-both #pane-3d{flex:1.75 1 0}   /* 立体视图多给点地方，免得挤成一团 */
  @media (max-width:1240px){ .stage{flex-direction:column} .pane{min-height:470px} }
  aside{
    width:392px; flex:none; border-left:1px solid var(--line-soft); background:linear-gradient(180deg,#0d131a,#0b1016);
    overflow:auto; padding:18px 20px 40px;
  }
  footer{border-top:1px solid var(--line-soft); padding:10px 18px 14px; display:flex; gap:18px; flex-wrap:wrap; align-items:center}
  .legend-title{color:var(--ink-3); font-size:12px; margin-right:2px}
  .chip{
    display:inline-flex; align-items:center; gap:7px; border:1px solid var(--line); background:var(--plate-2);
    border-radius:999px; padding:4px 11px; cursor:pointer; color:var(--ink-2); font-size:12.5px; user-select:none;
  }
  .chip:hover{border-color:#2d4457; color:var(--ink)}
  .chip[aria-pressed="false"]{opacity:.4}
  .dot{width:9px; height:9px; border-radius:50%}
  .dash{width:16px; height:0; border-top:2px dashed currentColor}
  /* ---- SVG 图 ---- */
  svg{display:block; width:100%; height:auto}
  .band{fill:#0f1720; stroke:var(--line-soft); stroke-width:1}
  .band-name{fill:var(--ink-3); font-size:12px; letter-spacing:2px}
  .band-gist{fill:#41586d; font-size:11px}
  .node{cursor:pointer}
  .node .card{fill:var(--plate); stroke:var(--line); stroke-width:1; rx:12}
  .node:hover .card{stroke:#3a5b74}
  .node.on .card{stroke:var(--accent); stroke-width:1.6}
  .node .name{fill:var(--ink); font-size:14px; font-weight:600}
  .node .gist{fill:var(--ink-2); font-size:12px}
  .node .meta{fill:var(--ink-3); font-size:11px}
  .node .kindbar{rx:2}
  .node .badge{fill:#16222e; stroke:var(--line); stroke-width:.8; rx:7}
  .node .badgetext{fill:var(--ink-3); font-size:10.5px}
  .node.dim{opacity:.22}
  .node.ghost .card{stroke-dasharray:4 4}
  .flow{fill:none; stroke-width:1.8; marker-end:url(#arrow); opacity:.85}
  .flow-hit{fill:none; stroke:transparent; stroke-width:14; cursor:pointer}
  .flow.dim{opacity:.1}
  .flow.on{stroke-width:3.2; opacity:1; filter:drop-shadow(0 0 6px currentColor)}
  .flowlabel{fill:var(--ink-3); font-size:10.5px; pointer-events:none}
  .flowlabel.on{fill:var(--ink); font-size:11.5px}
  .pulse{stroke-dasharray:7 9}
  @keyframes flow{to{stroke-dashoffset:-32}}
  /* ---- 侧栏 ---- */
  .panel h2{margin:0 0 2px; font-size:17px}
  .panel .sub{color:var(--ink-3); font-size:12px; margin-bottom:14px}
  .panel .gist{
    background:#13202b; border-left:3px solid var(--accent); border-radius:0 10px 10px 0;
    padding:11px 13px; font-size:15px; line-height:1.65; margin:0 0 16px;
  }
  .panel h3{margin:18px 0 7px; font-size:12px; letter-spacing:1.4px; color:var(--ink-3); text-transform:uppercase}
  .panel p{margin:0 0 10px; color:var(--ink-2)}
  .panel ul{margin:0; padding-left:17px; color:var(--ink-2)}
  .panel li{margin:3px 0}
  .panel code{background:#101a23; border:1px solid var(--line-soft); border-radius:5px; padding:1px 5px; font-size:12px; color:#a8d8e8}
  .tags{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px}
  .tag{border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:11.5px; color:var(--ink-2)}
  .empty{color:var(--ink-3); text-align:center; margin-top:60px; line-height:2}
  /* 侧栏改成完整编辑器后，不再靠"藏字段"分人读/机读面；机器字段改用 .mach 标注。 */
  .lock{font-size:11.5px; color:var(--ink-3); border:1px dashed var(--line); border-radius:8px; padding:7px 10px; margin-top:10px}
  .reading-summary,.scenario-reading{border-bottom:1px solid var(--line);padding:10px 0 16px;margin-bottom:14px}
  .reading-actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .reading-actions .ghost{text-align:left;white-space:normal}
  .reading-gap{font-size:12px;color:var(--ink-3)}
  .engineering-details{margin:14px 0;border-top:1px solid var(--line);padding-top:10px}
  .engineering-details>summary{cursor:pointer;color:var(--accent);font-size:13px}
  .evidence-row{border-bottom:1px solid var(--line-soft);padding:8px 0;overflow-wrap:anywhere}
  .scenario-steps{padding-left:22px;color:var(--ink-2)}
  .scenario-steps [aria-current="step"]{border-color:var(--accent);color:var(--accent)}
  /* ---- 由表及里：三级步进 ---- */
  .depthbar{display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:0 0 14px}
  .depthbar .depthlead{font-size:11px; letter-spacing:1.4px; color:var(--ink-3)}
  .dstep{background:var(--plate-2); border:1px solid var(--line); color:var(--ink-2); border-radius:999px; padding:4px 10px; font:inherit; font-size:12px; cursor:pointer}
  .dstep:hover{border-color:#3a5b74; color:var(--ink)}
  .dstep{transition:none; outline:none; -webkit-tap-highlight-color:transparent}
  .dstep.on{background:#1d3346; border-color:var(--accent); color:#eaf6ff; font-weight:600; box-shadow:0 0 8px rgba(99,230,255,.22)}
  .ghost.deeper{display:block; width:100%; text-align:left; margin:8px 0 4px; font-size:12.5px}
  /* 器官群：缩到最左侧的小列表（画布上不再占地方） */
  .group-list{position:absolute; left:10px; top:64px; z-index:3; display:flex; flex-direction:column; gap:3px; max-height:calc(100% - 120px); overflow:auto; padding-right:2px}
  .group-list .gl{display:flex; align-items:center; gap:6px; cursor:pointer; font-size:11.5px; color:var(--ink-2);
    background:rgba(11,17,24,.66); border:1px solid var(--line-soft); border-radius:7px; padding:2px 7px; white-space:nowrap}
  .group-list .gl:hover{border-color:#3a5b74; color:var(--ink)}
  .group-list .gl.on{background:#1d3346; color:#eaf6ff; border-color:var(--accent); font-weight:600}
  .group-list .gl .n{color:var(--ink-3); font-size:10.5px}
  .layer-tip{position:absolute; left:12px; bottom:10px; right:12px; z-index:3; pointer-events:none;
    font-size:12.5px; color:#9fb0c2; background:rgba(11,17,24,.72); border:1px solid #17222d; border-radius:9px;
    padding:7px 11px; line-height:1.55}
  /* ---- 共读编辑 ---- */
  .ed{outline:none; border-bottom:1px dashed transparent; border-radius:3px; padding:0 2px; transition:background .12s}
  .ed:hover{background:#16222e; border-bottom-color:#2d4457}
  .ed:focus{background:#16222e; border-bottom-color:var(--accent); box-shadow:0 0 0 2px rgba(99,230,255,.12)}
  .ed:empty:before{content:attr(data-ph); color:#4a5f73}
  .ed-title{font-size:17px; font-weight:600}
  .ed-gist{display:block}
  .ed-block{display:block; color:var(--ink-2)}
  .ed-list{list-style:none; margin:0; padding:0; color:var(--ink-2)}
  .ed-list li{display:flex; gap:8px; align-items:baseline; padding:3px 0; border-bottom:1px solid #131d27}
  .ed-list li.add{opacity:.62}
  .ed-list li.add:hover{opacity:.9}
  .ed-key{min-width:92px; color:#a8d8e8}
  .ed-val{flex:1}
  /* 删一条：以前只能"清空即删除"，太隐晦；现在每条hover就有 ✕ */
  .ed-list li .row-del{flex:none; align-self:center; border:none; background:none; color:#4a5f73; cursor:pointer;
    font:inherit; font-size:12px; line-height:1; padding:2px 4px; opacity:0; transition:opacity .12s, color .12s}
  .ed-list li:hover .row-del{opacity:1}
  .ed-list li .row-del:hover{color:#ff9b9b}
  /* 整字段替换的控件：下拉与多选 */
  .fieldline{display:flex; gap:8px; align-items:center; padding:3px 0; font-size:12.5px; border-bottom:1px solid #131d27}
  .fieldline .flabel{min-width:92px; color:#6b7f93; flex:none}
  .ed-select{flex:1; min-width:0; background:var(--plate-2); color:var(--ink); border:1px solid var(--line);
    border-radius:6px; padding:3px 6px; font:inherit; font-size:12.5px; cursor:pointer}
  .ed-select:hover{border-color:#3a5b74}
  .ed-select:focus{outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(99,230,255,.12)}
  .chips-edit{flex:1; display:flex; flex-wrap:wrap; gap:6px; align-items:center}
  .chip-edit{display:inline-flex; gap:6px; align-items:center; border:1px solid var(--line); border-radius:999px;
    padding:2px 6px 2px 10px; font-size:11.5px; color:var(--ink-2)}
  .chip-edit button{border:none; background:none; color:#6b7f93; cursor:pointer; font:inherit; font-size:12px; line-height:1; padding:0}
  .chip-edit button:hover{color:#ff9b9b}
  /* 完整编辑器：一栏一段，机器字段只做标注、不再隐藏 */
  .panel .sect{margin-top:16px; border-top:1px solid var(--line-soft); padding-top:10px}
  .panel .sect > h3:first-child{margin-top:0}
  .mach{font-size:10px; color:#5c7286; border:1px solid var(--line-soft); border-radius:999px; padding:1px 7px;
    margin-left:6px; vertical-align:1px; letter-spacing:.3px}
  .flowlinks{list-style:none; margin:0; padding:0; color:var(--ink-2)}
  .flowlinks li{padding:3px 0; border-bottom:1px solid #131d27; cursor:pointer}
  .flowlinks li:hover{color:var(--ink); background:#16222e}
  .ghost{background:none; border:1px dashed var(--line); color:var(--ink-2); border-radius:8px; padding:6px 12px; cursor:pointer; font:inherit; font-size:12.5px}
  .ghost:hover{border-color:#3a5b74; color:var(--ink)}
  .ghost.danger{border-color:#5a2a2a; color:#ffb4b4}
  .edit-hint{margin-top:14px; font-size:11.5px; color:#4a5f73; line-height:1.8; border-top:1px solid #131d27; padding-top:10px}
  .planned{color:#ffb454; border:1px solid #5a4a2a; border-radius:999px; padding:1px 7px; font-size:11px}
  .editbar{position:fixed; left:50%; bottom:14px; transform:translateX(-50%); transition:opacity .18s ease-out;
    display:flex; gap:10px; align-items:center; background:#13202b; border:1px solid #2d4457; border-radius:12px;
    padding:9px 14px; box-shadow:0 10px 30px rgba(0,0,0,.5); z-index:20; font-size:12.5px; color:var(--ink-2)}
  .editbar button[disabled]{opacity:.35; cursor:default}
  .ghost.arming{border-color:#7a4a2a; color:#ffcf9a; background:#2a1d12}
  .editbar button{background:#1b2a38; border:1px solid var(--line); color:var(--ink); border-radius:8px; padding:5px 11px; cursor:pointer; font:inherit; font-size:12.5px}
  .editbar button:hover{border-color:#3a5b74}
  .editbar button.danger{border-color:#5a2a2a; color:#ffb4b4}
</style>
</head>
<body class="mode-human view-both">
<div class="banner" id="banner"></div>
<header>
  <div class="headline">
    <h1 id="t-title"></h1>
    <p class="oneline" id="t-oneline"></p>
    <div class="vitals" id="t-vitals"></div>
  </div>
  <div class="controls">
    <div class="seg" id="mode-seg">
      <button data-mode="human" aria-pressed="true">👤 人读</button>
      <button data-mode="agent" aria-pressed="false">🤖 机读</button>
    </div>
    <div class="seg" id="view-seg">
      <button data-view="2d" aria-pressed="false">平面</button>
      <button data-view="3d" aria-pressed="false">立体</button>
      <button data-view="both" aria-pressed="true">双联</button>
    </div>
    <div class="seg" id="depth-seg">
      <button data-depth="1" aria-pressed="true" title="先看全貌：这是一具什么样的身体、由哪几部分组成">① 外膜</button>
      <button data-depth="2" aria-pressed="false" title="揭开外膜：看里面处理信息的器官（形状=职能）">② 器官</button>
      <button data-depth="3" aria-pressed="false" title="再往里：成分与契约（它由什么构成、和谁约定了什么）">③ 骨架</button>
      <button data-depth="4" aria-pressed="false" title="最里面：数据流动与交换（粗细=载荷、颜色=物质、箭头=方向）">④ 脉络</button>
    </div>
    <input type="search" id="q" placeholder="搜职责、文件或符号">
  </div>
</header>
<main>
  <div class="stage" id="stage">
    <div class="pane" id="pane-2d">
      <div class="pane-tag">平面 · 读<span class="hint">滚轮缩放 · 拖动平移 · 双击复位</span>
        <span class="tools"><button id="reset2d" title="缩放平移复位（整张图看全）">复位</button></span>
      </div>
      <svg id="chart" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div class="pane" id="pane-3d">
      <div class="pane-tag">立体 · 看懂<span class="hint" id="hint3d">左键拖动旋转 · Shift/右键平移 · 滚轮缩放 · 双击复位</span>
        <span class="tools">
          <button id="zoom-in" title="放大">＋</button>
          <button id="zoom-out" title="缩小">－</button>
          <button id="reset3d" title="复位视角（连平移一起）">复位</button>
          <button id="dragmode" aria-pressed="false" title="切换左键拖动的作用">拖动·平移</button>
          <button id="labels" aria-pressed="false">名字·邻域</button>
          <button id="spin" aria-pressed="false">自转</button>
        </span>
      </div>
      <svg id="chart3d" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="group-list" id="grouplist"></div>
      <div class="layer-tip" id="layertip"></div>
    </div>
  </div>
  <aside class="panel" id="panel"></aside>
</main>
<footer>
  <span class="legend-title">血（物质）</span><span id="legend-media"></span>
  <span class="legend-title" style="margin-left:14px">系统</span><span id="legend-systems"></span>
</footer>
<div class="editbar" id="editbar"><span id="editbar-text"></span>
  <button id="bar-action" style="display:none"></button>
  <button data-act="undo" title="Ctrl+Z">↶ 撤销</button>
  <button data-act="redo" title="Ctrl+Shift+Z">↷ 重做</button>
  <button data-act="export">保存到工程</button>
  <button data-act="copy">复制</button>
  <button data-act="discard" class="danger">放弃</button>
</div>
<script>
/*__CLIENT__*/
</script>

</body>
</html>
`
