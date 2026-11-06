/* 素材工作台 · 改版交互层（全中文 · 零外部请求） */
import { NAV, LANES_BY_VIEW, CATEGORIES, BARS, FIRST_BAR, ASSETS, CHATS, MESSAGES,
         TIMELINE, CLIP_TOOLS, SETTING_FIELDS, LOGO_PLANS, FILTER_GROUPS } from './data.js';
import { ICONS, iconPath } from './icons.js';
import { createMorph } from './vendor/morphicons/dom.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const html = document.documentElement;
const rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => rmQuery.matches;

const state = {
  view:'assets', lane:'image', category:'interior_exterior', clip:'timeline', setting:'daily',
  mode:'chat', logo:localStorage.getItem('wb_logo') || 'four',
  theme:localStorage.getItem('wb_theme') || 'eye-care',
  current:1, selectMode:false, selected:new Set(), narrow:new Set(), playing:false,
};

/* ------------------------------------------------------------ 通用 */
function svg(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${iconPath(name)}" fill="currentColor" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/></svg>`;
}
let toastTimer = 0;
function toast(text) {
  const el = $('#toast'); el.textContent = text; el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => el.hidden = true, 260); }, 2400);
}
function stagger(root) {
  if (!root || reduced()) return;
  $$('.enter', root).forEach((el,i) => {
    el.classList.remove('is-in');
    setTimeout(() => el.classList.add('is-in'), Math.min(i,5) * 40);
  });
}
function setTheme(key, animate = false) {
  const apply = () => { html.classList.remove('eye-care','light','dark'); html.classList.add(key); };
  if (animate && !reduced() && document.startViewTransition) {
    const vt = document.startViewTransition(apply); vt.finished?.catch(() => {});
  } else apply();
  state.theme = key; localStorage.setItem('wb_theme', key);
  if (drawerType === 'display') openDrawer('display','显示设置');
}
function setSize(size) {
  html.classList.toggle('senior-mode', size !== 'normal');
  html.classList.toggle('super-mode', size === 'super');
  localStorage.setItem('wb_size', size);
  toast({ normal:'已切换到标准大小', senior:'已开启适老化大字模式', super:'已开启超大字模式' }[size]);
  if (drawerType === 'display') openDrawer('display','显示设置');
}
function setLogo(key) {
  state.logo = key; localStorage.setItem('wb_logo', key);
  $('#logo-slot').innerHTML = LOGO_PLANS.find(p => p.key === key)?.svg || LOGO_PLANS[0].svg;
  renderPanes();
}
function currentAsset() { return ASSETS.find(a => a.id === state.current) || ASSETS[0]; }
function laneLabel() { return LANES_BY_VIEW[state.view].find(l => l.key === state.lane)?.label || ''; }
function categoryLabel() { return BARS[state.view].classify.find(c => c.key === state.category)?.label || ''; }
function updatePath() {
  const parts = [NAV.find(n => n.key === state.view)?.label, laneLabel()];
  if (state.view === 'assets') parts.push(categoryLabel());
  $('#path-text').textContent = parts.filter(Boolean).join(' / ');
}

/* ------------------------------------------------------------ 顶栏 */
$('#main-nav').innerHTML = NAV.map((n,i) =>
  `<button type="button" class="nav-btn${i===0?' is-on':''}" data-view="${n.key}">${n.label}</button>`).join('');
$$('.nav-btn').forEach(b => b.onclick = () => switchView(b.dataset.view, true));

function renderLanes() {
  $('#lane-row').innerHTML = LANES_BY_VIEW[state.view].map(l => `
    <button type="button" class="lane${l.key===state.lane?' is-on':''}" data-lane="${l.key}" role="tab" aria-selected="${l.key===state.lane}">
      ${l.label}${l.count ? `<small>${l.count}</small>` : ''}
    </button>`).join('');
  $$('[data-lane]').forEach(b => b.onclick = () => {
    state.lane = b.dataset.lane;
    if (state.view === 'settings') state.setting = state.lane;
    if (state.view === 'clip') state.clip = state.lane === 'tools' ? 'tools' : 'timeline';
    renderLanes(); renderBars(); renderPanes(); updatePath();
  });
}
function renderBars() {
  const cfg = BARS[state.view];
  const hasClassify = cfg.classify.length > 0;
  $('#classify-group').style.display = hasClassify ? '' : 'none';
  $('.group-rule').style.display = hasClassify ? '' : 'none';
  $('#classify-group').innerHTML = cfg.classify.map(c => `
    <button type="button" class="seg-btn${c.key===state.category?' is-on':''}" data-classify="${c.key}" role="tab" aria-selected="${c.key===state.category}">${c.label}</button>`).join('');
  $$('[data-classify]').forEach(b => b.onclick = () => {
    state.category = b.dataset.classify;
    state.current = (ASSETS.find(a => a.category === state.category) || ASSETS[0]).id;
    renderBars(); renderPanes(); updatePath(); updateCount();
  });
  $('#narrow-group').innerHTML = cfg.narrow.map(n => {
    if (n.type === 'select') return `<select class="mini-select" data-narrow="${n.key}" aria-label="${n.label}"><option>${n.label}：全部</option><option>客厅</option><option>主卧</option><option>样板间</option></select>`;
    const on = state.narrow.has(n.key);
    return `<button type="button" class="mini-btn${on?' is-on':''}" data-narrow="${n.key}" aria-pressed="${on}">${n.label}${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</button>`;
  }).join('');
  $$('[data-narrow]').forEach(el => {
    if (el.tagName === 'SELECT') { el.onchange = () => toast(`已选择：${el.value}`); return; }
    el.onclick = () => {
      const k = el.dataset.narrow;
      if (k === 'multi') { state.selectMode = !state.selectMode; renderPanes(); updateCount(); return; }
      if (k === 'filters' || k === 'params' || k === 'advanced' || k === 'help') {
        openDrawer(k === 'filters' ? 'filters' : 'generic', k === 'filters' ? '筛选条件' : '更多选项'); return;
      }
      state.narrow.has(k) ? state.narrow.delete(k) : state.narrow.add(k);
      renderBars(); renderPanes(); updateCount();
      toast(el.textContent.trim().replace(/\d+$/,'') + (state.narrow.has(k) ? '：已开启' : '：已关闭'));
    };
  });
}
function updateFirstBar() {
  const c = FIRST_BAR[state.view];
  $('#global-search').placeholder = c.placeholder;
  $('#btn-upload').textContent = c.action;
  if (state.view !== 'assets') $('#result-count').textContent = c.count;
}
function updateCount() {
  if (state.view !== 'assets') { updateFirstBar(); return; }
  $('#result-count').textContent = `共匹配 ${visibleAssets().length} 件素材`;
}
function visibleAssets() {
  let list = ASSETS.filter(a => a.category === state.category);
  if (state.narrow.has('retouched')) list = list.filter(a => a.tag === '精修');
  if (state.narrow.has('finished')) list = list.filter(a => a.tag === '成品');
  if (!list.length) list = ASSETS.filter(a => a.category === state.category);
  return list.length ? list : ASSETS;
}

/* ------------------------------------------------------------ 板块切换 */
function switchView(key, animate = false) {
  const apply = () => {
    state.view = key;
    state.lane = LANES_BY_VIEW[key][0].key;
    state.category = BARS[key].classify[0]?.key || ''; // 设置等板块没有三级归类
    state.setting = key === 'settings' ? 'daily' : state.setting;
    if (key === 'clip') state.clip = 'timeline';
    $$('.nav-btn').forEach(b => b.classList.toggle('is-on', b.dataset.view === key));
    renderLanes(); renderBars(); renderPanes(); updatePath(); updateFirstBar(); updateCount(); updateLoopStatus();
    const label = NAV.find(n => n.key === key)?.label;
    if (label) history.replaceState(null, '', `#${label}`);
  };
  if (animate && !reduced() && document.startViewTransition) {
    const vt = document.startViewTransition(apply); vt.finished?.catch(() => {});
  } else apply();
}

/* ------------------------------------------------------------ 主视口 */
function renderPanes() {
  const main = $('#pane-main'), side = $('#pane-side');
  main.classList.toggle('pane-chat', state.view === 'studio');
  if (state.view === 'assets') renderAssets(main, side);
  else if (state.view === 'studio') renderStudio(main, side);
  else if (state.view === 'clip') renderClip(main, side);
  else renderSettings(main, side);
  stagger($('#workspace'));
}
function bars(color) {
  return `<div class="hero-bars"><i></i><i></i><i></i><i></i><i></i></div>`;
}
function renderAssets(main, side) {
  const a = currentAsset();
  main.innerHTML = `
    <div class="zone enter">
      <div class="hero-frame"><div class="hero-visual" style="background:${a.color}">
        <span class="hero-mark"></span><span class="hero-tag">${a.tag}</span>${bars()}
      </div></div>
    </div>
    <div class="zone enter">
      <h2 class="hero-name">${a.name}</h2>
      <div class="kv-row"><span>类型 <b>${a.type}</b></span><span>日期 <b>${a.date}</b></span>
        <span>空间 <b>${a.space}</b></span><span>状态 <b>已入库</b></span></div>
    </div>
    <div class="zone enter action-row">
      <button type="button" class="btn primary" data-hero="detail">查看详情</button>
      <button type="button" class="btn" data-hero="studio">送入创作</button>
      <button type="button" class="btn" data-hero="clip">送入剪辑</button>
      <button type="button" class="btn" data-hero="download">下载原素材</button>
    </div>
    <div class="zone enter">
      <p class="pane-sub" style="margin-bottom:12px">衍生版本 · 共 3 个</p>
      <div class="derivatives"><i style="background:${a.color}"></i><i style="background:var(--bg-stage)"></i><i style="background:var(--bg-panel)"></i></div>
      <p class="hint">被 2 个剪辑工程引用，删除前需先解除引用。</p>
    </div>`;
  $$('[data-hero]').forEach(b => b.onclick = () => {
    const act = b.dataset.hero;
    if (act === 'detail') openDrawer('asset','资产详情');
    else if (act === 'studio') { switchView('studio'); toast('已把素材挂载到创作输入舱'); }
    else if (act === 'clip') { switchView('clip'); toast('已把素材送入剪辑素材箱'); }
    else toast('已开始下载原素材');
  });

  const list = visibleAssets();
  side.innerHTML = `
    <div class="grid-head enter"><strong>全部素材</strong><span class="meta">共 ${list.length} 件 · 点击切换主区</span></div>
    <div class="asset-grid enter">${list.map(x => `
      <button type="button" class="asset-card${x.id===state.current?' is-current':''}" data-id="${x.id}">
        <span class="asset-thumb" style="background:${x.color}"><i></i><i></i><i></i><i></i><span class="tag">${x.tag}</span></span>
        <span class="asset-body"><strong>${x.name}</strong><span class="card-meta">${x.date}</span></span>
      </button>`).join('')}</div>
    <div class="sel-dock" id="sel-dock" ${state.selectMode ? '' : 'hidden'}>
      <button type="button" class="btn" data-sel="all">全选本页</button>
      <button type="button" class="btn" data-sel="clear">清空</button>
      <button type="button" class="btn" data-sel="studio">送入创作</button>
      <button type="button" class="btn" data-sel="clip">送入剪辑</button>
    </div>`;
  $$('.asset-card').forEach(c => c.onclick = () => {
    const id = +c.dataset.id;
    if (state.selectMode) { state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); renderPanes(); return; }
    state.current = id; renderPanes();
  });
  $$('[data-sel]').forEach(b => b.onclick = () => {
    if (b.dataset.sel === 'all') visibleAssets().forEach(x => state.selected.add(x.id));
    if (b.dataset.sel === 'clear') state.selected.clear();
    if (b.dataset.sel === 'studio') { switchView('studio'); toast(`已送入 ${state.selected.size} 件素材`); return; }
    if (b.dataset.sel === 'clip') { switchView('clip'); toast(`已送入 ${state.selected.size} 件素材`); return; }
    renderPanes(); toast(`已选 ${state.selected.size} 件`);
  });
}
function renderStudio(main, side) {
  main.innerHTML = `
    <div class="zone enter"><h2 class="pane-title">现代客厅软装方案</h2>
      <p class="pane-sub">当前会话 · 通用创作模型</p></div>
    <div class="chat-flow enter">${MESSAGES.map(m => `<div class="msg ${m.role==='me'?'me':''}"><span class="who">${m.role==='me'?'我':'智能助手'}</span>${m.text}</div>`).join('')}</div>
    <div class="composer enter">
      <label class="prompt-box"><textarea id="prompt-input" rows="3" placeholder="描述想要的效果，例如：把墙面换成暖胡桃木饰面……"></textarea></label>
      <div class="composer-actions">
        <button type="button" class="btn" id="btn-ref">引用素材</button>
        <button type="button" class="btn" id="btn-attach">挂载素材</button>
        <button type="button" class="btn primary" id="btn-send">发送</button>
      </div>
    </div>`;
  $('#btn-send').onclick = () => {
    const v = $('#prompt-input').value.trim();
    if (!v) { toast('请先描述想要的效果'); return; }
    MESSAGES.push({ role:'me', text:v }); $('#prompt-input').value='';
    toast('已提交生成任务'); renderPanes();
  };
  $('#btn-ref').onclick = () => toast('已打开资产引用列表');
  $('#btn-attach').onclick = () => toast('可从「资产」一键挂载');
  side.innerHTML = `
    <div class="grid-head enter"><strong>会话</strong><span class="meta">点击切换</span></div>
    ${CHATS.map(g => `<div class="enter"><p class="chat-group">${g.group}</p><div class="chat-list">${g.items.map((t,i) => `<button type="button" class="chat-item${g.group==='今天'&&i===0?' is-on':''}" data-chat="${t}">${t}</button>`).join('')}</div></div>`).join('')}
    <div class="zone enter"><button type="button" class="btn primary" id="new-chat" style="width:100%">新建对话</button></div>
    <div class="zone enter"><p class="pane-sub" style="margin-bottom:10px">看图区</p><div class="derivatives"><i style="background:#C9BFA8"></i><i style="background:#8B6A45"></i></div></div>`;
  $$('[data-chat]').forEach(b => b.onclick = () => { $$('[data-chat]').forEach(x=>x.classList.toggle('is-on',x===b)); toast(`已打开：${b.dataset.chat}`); });
  $('#new-chat').onclick = () => { $('#prompt-input')?.focus(); toast('已新建对话'); };
}
function renderClip(main, side) {
  main.innerHTML = `
    <div class="zone enter"><h2 class="pane-title">秋季方案成片</h2><p class="pane-sub">多轨时间轴 · 每秒 25 帧</p></div>
    <div class="zone enter"><div class="preview-screen"><strong>画面预览</strong><span class="meta">16 : 9 · 1920 × 1080</span></div>
      <div class="action-row"><button type="button" class="btn" id="btn-play"><span id="play-icon"></span> 播放</button>
        <span class="num">00:00:00 / 00:01:24</span></div></div>
    <div class="zone enter"><div class="timeline">
      <div class="timeline-ruler">${Array.from({length:10},(_,i)=>`<span>${String(i*5).padStart(2,'0')}秒</span>`).join('')}</div>
      ${TIMELINE.map(t => `<div class="track"><span class="track-name">${t.name}</span><div class="track-lane">${t.clips.map(c=>`<span class="track-clip" style="color:${t.color}">${c}</span>`).join('')}</div></div>`).join('')}
    </div></div>`;
  initPlayMorph();
  side.innerHTML = `
    <div class="grid-head enter"><strong>素材箱</strong><span class="meta">4 项</span></div>
    <div class="zone enter">${['客厅软装实景','样板间漫游短片','空间环境音','材质特写运镜'].map(x=>`<div class="bin-item">${x}</div>`).join('')}</div>
    <div class="zone enter">${CLIP_TOOLS.map(t=>`<div class="tool-card"><h3>${t.name}</h3><p>${t.desc}</p></div>`).join('')}</div>`;
}
function initPlayMorph() {
  const holder = $('#play-icon'); if (!holder) return;
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${iconPath('play')}" fill="currentColor"/></svg>`;
  const path = $('path', holder); let engine = null;
  try { engine = createMorph(path, iconPath('play'), { reducedMotion:'user', strokeWidth:2 }); } catch {}
  $('#btn-play').onclick = () => {
    state.playing = !state.playing;
    const next = state.playing ? 'pause' : 'play';
    try { if (engine) engine.morphTo(iconPath(next)); else path.setAttribute('d', iconPath(next)); }
    catch { path.setAttribute('d', iconPath(next)); }
    $('#btn-play').lastChild.textContent = state.playing ? ' 暂停' : ' 播放';
  };
}
function renderSettings(main, side) {
  const isBrand = state.setting === 'brand';
  const plan = LOGO_PLANS.find(p => p.key === state.logo) || LOGO_PLANS[0];
  main.innerHTML = isBrand ? `
    <div class="zone enter"><h2 class="pane-title">品牌标识</h2><p class="pane-sub">切换方案，顶栏标识会实时更新</p></div>
    <div class="zone enter"><div class="big-preview"><span class="logo-big">${plan.svg}</span><strong>${plan.name}</strong></div></div>
    <div class="zone enter"><div class="logo-picker">${LOGO_PLANS.map(p=>`<button type="button" class="logo-choice${p.key===state.logo?' is-on':''}" data-logo="${p.key}">${p.name}${p.recommended?' · 推荐':''}</button>`).join('')}</div></div>
    <div class="zone enter"><div class="mono-preview" style="--logo-accent:currentColor"><span class="logo-mini">${plan.svg}</span><span>单色适配</span></div>
      <p class="hint">${plan.idea}；${plan.why}。适用：${plan.use}。</p></div>` : `
    <div class="zone enter"><h2 class="pane-title">${laneLabel()}</h2><p class="pane-sub">当前模块的实时状态与效果</p></div>
    <div class="zone enter"><div class="big-preview"><strong style="font-size:clamp(2rem,4vw,3.4rem);font-weight:900">${laneLabel()}</strong><span class="meta">配置即时生效，无需重启</span></div></div>
    <div class="zone enter"><p class="hint">低频管理项收在左侧导航与更多选项中；常用设置保持常驻，避免长页面翻找。</p></div>`;
  $$('[data-logo]').forEach(b => b.onclick = () => { setLogo(b.dataset.logo); toast(`已切换标识：${b.textContent.split(' · ')[0]}`); });

  const fields = SETTING_FIELDS[state.setting] || SETTING_FIELDS.daily;
  side.innerHTML = `
    <div class="grid-head enter"><strong>设置项</strong><span class="meta">共 ${fields.length} 项</span></div>
    <div class="zone enter">${fields.map(([k,v])=>`<div class="field"><label>${k}</label><span class="val">${v}</span></div>`).join('')}</div>
    <div class="zone enter action-row"><button type="button" class="btn primary" id="btn-save">保存设置</button><button type="button" class="btn" id="btn-reset">恢复默认</button></div>`;
  $('#btn-save').onclick = () => toast('设置已保存并立即生效');
  $('#btn-reset').onclick = () => { renderPanes(); toast('已恢复默认设置'); };
}

/* ------------------------------------------------------------ 抽屉 */
let drawerType = '';
function openDrawer(type, title) {
  drawerType = type;
  $('#drawer-title').textContent = title;
  const body = $('#drawer-body');
  if (type === 'display') {
    const t = [['eye-care','护眼'],['light','明亮'],['dark','暗黑']];
    body.innerHTML = `
      <div class="drawer-sec"><h3>界面主题</h3><div class="drawer-row">${t.map(([k,n])=>`<button type="button" class="btn${state.theme===k?' on':''}" data-theme="${k}">${n}</button>`).join('')}</div></div>
      <div class="drawer-sec"><h3>字体与按钮大小</h3><div class="drawer-row">
        <button type="button" class="btn${!html.classList.contains('senior-mode')?' on':''}" data-size="normal">标准</button>
        <button type="button" class="btn${html.classList.contains('senior-mode')&&!html.classList.contains('super-mode')?' on':''}" data-size="senior">适老</button>
        <button type="button" class="btn${html.classList.contains('super-mode')?' on':''}" data-size="super">超大</button></div>
        <p class="hint">标准 17 / 适老 22 / 超大 25 像素；按钮高 52 / 68 / 76 像素，导航与输入框同步放大。</p></div>
      <div class="drawer-sec"><h3>动效</h3><div class="drawer-row"><button type="button" class="btn${html.classList.contains('motion-off')?' on':''}" data-motion="toggle">${html.classList.contains('motion-off')?'恢复动效':'暂停全部动效'}</button></div>
        <p class="hint">系统「减少动态效果」：${reduced()?'已开启，全部动效停在终态':'未开启'}。循环动效同一时刻最多 2 个。</p></div>
      <div class="drawer-sec"><h3>本地资源检查</h3><p class="hint" id="asset-check">正在检查……</p></div>`;
  } else if (type === 'filters') {
    body.innerHTML = FILTER_GROUPS.map(([title,items]) => `
      <div class="drawer-sec"><h3>${title}</h3><div class="drawer-row">${items.map((x,i)=>`<button type="button" class="mini-btn${i===0?' is-on':''}" data-filter="${x}">${x}</button>`).join('')}</div></div>`).join('')
      + `<button type="button" class="btn primary" id="filter-apply" style="width:100%">应用筛选条件</button>`;
  } else if (type === 'asset') {
    const a = currentAsset();
    body.innerHTML = `<div class="drawer-sec"><h3>${a.name}</h3>
      <div class="big-preview" style="min-height:180px;background:${a.color}"></div>
      <p class="hint">类型 ${a.type} · 日期 ${a.date} · 空间 ${a.space}<br />被 2 个剪辑工程引用，删除前需先解除引用。</p></div>
      <div class="drawer-sec"><h3>可执行操作</h3><div class="drawer-row"><button type="button" class="btn" data-asset-act="studio">送入创作</button><button type="button" class="btn" data-asset-act="clip">送入剪辑</button></div></div>`;
  } else {
    body.innerHTML = `<div class="drawer-sec"><h3>更多选项</h3><p class="hint">低频参数与高级设置收在这里，常用操作保持常驻，不需要反复打开抽屉。</p></div>
      <div class="drawer-sec"><h3>可用项</h3><div class="drawer-row"><button type="button" class="btn" data-generic="a">模型参数</button><button type="button" class="btn" data-generic="b">技能挂载</button><button type="button" class="btn" data-generic="c">预览请求</button></div></div>`;
  }
  $('#drawer').hidden = false; $('#scrim').hidden = false; bindDrawer(); stagger(body);
}
function bindDrawer() {
  $$('[data-theme]').forEach(b => b.onclick = () => setTheme(b.dataset.theme, true));
  $$('[data-size]').forEach(b => b.onclick = () => setSize(b.dataset.size));
  $$('[data-motion]').forEach(b => b.onclick = () => {
    html.classList.toggle('motion-off');
    toast(html.classList.contains('motion-off') ? '已暂停全部动效' : '已恢复动效');
    openDrawer('display','显示设置'); updateLoopStatus();
  });
  $$('[data-filter]').forEach(b => b.onclick = () => {
    $$('[data-filter]').forEach(x => { if (x.parentElement === b.parentElement) x.classList.remove('is-on'); });
    b.classList.add('is-on');
  });
  $('#filter-apply')?.addEventListener('click', () => { closeDrawer(); toast('筛选条件已应用'); });
  $$('[data-asset-act]').forEach(b => b.onclick = () => {
    closeDrawer();
    if (b.dataset.assetAct === 'studio') { switchView('studio'); toast('已挂载到创作'); }
    else { switchView('clip'); toast('已送入剪辑'); }
  });
  $$('[data-generic]').forEach(b => b.onclick = () => toast(`已打开：${b.textContent}`));
  const box = $('#asset-check');
  if (box) {
    const ext = performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/^https?:\/\//i.test(u)&&!u.startsWith(location.origin));
    box.textContent = `本地字体 6 个 · 本地图标 ${Object.keys(ICONS).length} 个 · 外部链接 ${ext.length} 个 · ${ext.length?'发现外链':'断网可用'}`;
  }
}
function closeDrawer() { $('#drawer').hidden = true; $('#scrim').hidden = true; drawerType = ''; }
$('#drawer-close').onclick = closeDrawer;
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerType) closeDrawer(); });

/* ------------------------------------------------------------ 其余绑定 */
$('#btn-display').onclick = () => openDrawer('display','显示设置');
$('#btn-user').onclick = () => toast('当前登录：管理员');
$('#btn-upload').onclick = () => toast(FIRST_BAR[state.view].toast);
$('#btn-voice').onclick = () => toast('语音输入已就绪，请开始说话');
$('#search-icon').innerHTML = svg('search', 26);
$('#btn-voice').innerHTML = svg('mic', 24);
$('#global-search').addEventListener('keydown', e => { if (e.key === 'Enter' && e.currentTarget.value.trim()) toast(`搜索：${e.currentTarget.value.trim()}`); });

function updateLoopStatus() {
  const n = (reduced() || html.classList.contains('motion-off')) ? 0 : 1;
  $('#loop-status').textContent = `循环动效 ${n} / 2`;
}
function updateRM() { $('#rm-status').textContent = `减少动态效果：${reduced()?'开':'关'}`; updateLoopStatus(); }
rmQuery.addEventListener?.('change', updateRM);
document.addEventListener('visibilitychange', updateLoopStatus);

/* ------------------------------------------------------------ 初始化 */
setTheme(state.theme);
const savedSize = localStorage.getItem('wb_size') || 'senior';
html.classList.toggle('senior-mode', savedSize !== 'normal');
html.classList.toggle('super-mode', savedSize === 'super');
setLogo(state.logo);
renderLanes(); renderBars(); renderPanes(); updatePath(); updateFirstBar(); updateCount(); updateRM();

const HASH = { '#资产':'assets', '#创作':'studio', '#剪辑':'clip', '#设置':'settings' };
const q = decodeURIComponent(location.search || '');
if (/brand/i.test(q) || q.includes('品牌')) {
  switchView('settings', false); state.setting = 'brand'; state.lane = 'brand';
  renderLanes(); renderPanes(); updatePath();
} else {
  const v = HASH[decodeURIComponent(location.hash || '')];
  if (v && v !== 'assets') switchView(v, false);
}
