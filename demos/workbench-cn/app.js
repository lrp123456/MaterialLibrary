/* 素材工作台 · 交互层（全中文 · 零外部请求） */
import { NAV, LANES, ASSETS, CHATS, MESSAGES, MODES, CLIP_TOOLS, TIMELINE,
         SETTINGS_GROUPS, SETTING_FIELDS, LOGO_PLANS, LOGO_METHOD, LOGO_REFS } from './data.js';
import { ICONS, iconPath } from './icons.js';
import { createMorph } from './vendor/morphicons/dom.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const html = document.documentElement;
const rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => rmQuery.matches;

const state = {
  view:'assets', lane:'image', clip:'timeline', setting:'daily', mode:'chat',
  logo:localStorage.getItem('workbench_logo') || 'four',
  selectMode:false, selected:new Set(), playing:false,
  theme:localStorage.getItem('workbench_theme') || 'eye-care',
};

/* ------------------------------------------------------------ 通用工具 */
function svg(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${iconPath(name)}" fill="currentColor" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/></svg>`;
}
let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-on');
    setTimeout(() => { el.hidden = true; }, 260);
  }, 2600);
}
function setTheme(key, animate = false) {
  const apply = () => { html.classList.remove('eye-care','light','dark'); html.classList.add(key); };
  if (animate && !reduced() && document.startViewTransition) {
    const vt = document.startViewTransition(apply);
    vt.finished?.catch(() => {});
  } else apply();
  state.theme = key;
  localStorage.setItem('workbench_theme', key);
  renderDisplayDrawer();
}
function setLogo(key) {
  state.logo = key;
  localStorage.setItem('workbench_logo', key);
  $('#logo-slot').innerHTML = LOGO_PLANS.find(p => p.key === key)?.svg || LOGO_PLANS[0].svg;
  $$('.logo-plan').forEach(c => {
    const on = c.dataset.key === key;
    c.classList.toggle('is-current', on);
    const b = $('.plan-btn', c);
    b.textContent = on ? '当前使用' : '设为当前标识';
    b.classList.toggle('is-on', on);
  });
}

/* ------------------------------------------------------------ 抽屉 */
let drawerType = '';
function openDrawer(type, title) {
  drawerType = type;
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = ({
    display: renderDisplayDrawer, filter: renderFilterDrawer,
    params: renderParamsDrawer, asset: renderAssetDrawer,
    service: renderServiceDrawer,
  })[type]?.() || '';
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  bindDrawer();
  stagger($('#drawer-body'));
}
function closeDrawer() { $('#drawer').hidden = true; $('#scrim').hidden = true; drawerType = ''; }
$('#drawer-close').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerType) closeDrawer(); });

function renderDisplayDrawer() {
  if (drawerType !== 'display') return '';
  const t = [['eye-care','护眼'],['light','明亮'],['dark','暗黑']];
  return `
    <div class="drawer-section"><h3>界面主题</h3><div class="drawer-row">
      ${t.map(([k,n]) => `<button type="button" class="big-btn${state.theme===k?' is-on':''}" data-theme="${k}">${n}</button>`).join('')}
    </div></div>
    <div class="drawer-section"><h3>字体与按钮大小</h3><div class="drawer-row">
      <button type="button" class="big-btn${!html.classList.contains('senior-mode')?' is-on':''}" data-size="normal">标准</button>
      <button type="button" class="big-btn${html.classList.contains('senior-mode')&&!html.classList.contains('super-mode')?' is-on':''}" data-size="senior">适老</button>
      <button type="button" class="big-btn${html.classList.contains('super-mode')?' is-on':''}" data-size="super">超大</button>
    </div><p class="setting-hint">标准 17 像素 / 适老 22 像素 / 超大 25 像素。适老档按钮高 68 像素、最小触控区 64 像素；超大档按钮高 76 像素、触控区 72 像素。导航、输入框、卡片与间距同步放大，是整站尺寸令牌变化，不是局部加粗。</p></div>
    <div class="drawer-section"><h3>动效</h3><div class="drawer-row">
      <button type="button" class="big-btn${html.classList.contains('motion-off')?' is-on':''}" data-motion="toggle">${html.classList.contains('motion-off')?'恢复动效':'暂停全部动效'}</button>
    </div><p class="setting-hint">系统「减少动态效果」：${reduced()?'已开启，全部动效自动停在终态':'未开启'}。循环动效同一时刻最多 2 个，切到后台自动暂停。</p></div>
    <div class="drawer-section"><h3>本地资源检查</h3><p class="setting-hint" id="asset-check">正在检查……</p></div>`;
}
function renderFilterDrawer() {
  const groups = [['素材状态','全部','只看精修','只看成品'],['空间','客厅','主卧','样板间','全屋'],['风格','现代','原木','侘寂','中式'],['色系','暖木','米白','灰石','深咖']];
  return groups.map(([title,...items]) => `
    <div class="drawer-section"><h3>${title}</h3><div class="drawer-row">
      ${items.map((x,i) => `<button type="button" class="big-btn${i===0?' is-on':''}" data-filter="${x}">${x}</button>`).join('')}
    </div></div>`).join('') + `<button type="button" class="big-btn primary" id="filter-apply" style="width:100%">应用筛选条件</button>`;
}
function renderParamsDrawer() {
  return `
    <div class="drawer-section"><h3>生成模型</h3><div class="drawer-row">
      <button type="button" class="big-btn is-on" data-param="model">通用创作模型</button>
      <button type="button" class="big-btn" data-param="model">轻量创作模型</button>
    </div></div>
    <div class="drawer-section"><h3>思考强度</h3><div class="drawer-row">
      <button type="button" class="big-btn" data-param="think">标准</button>
      <button type="button" class="big-btn is-on" data-param="think">高</button>
      <button type="button" class="big-btn" data-param="think">极高</button>
    </div></div>
    <div class="drawer-section"><h3>每次生成数量</h3><div class="drawer-row">
      ${[1,2,4,8].map((n,i) => `<button type="button" class="big-btn${i===2?' is-on':''}" data-param="count">${n} 张</button>`).join('')}
    </div></div>
    <div class="drawer-section"><h3>更多</h3><div class="drawer-row">
      <button type="button" class="big-btn" data-param="skill">技能挂载</button>
      <button type="button" class="big-btn" data-param="preview">预览请求</button>
    </div><p class="setting-hint">低频参数收在抽屉里，当前选择会常显在输入舱上方，不用反复打开。</p></div>`;
}
function renderAssetDrawer() {
  const a = ASSETS.find(x => x.id === state.currentAsset) || ASSETS[0];
  return `
    <div class="drawer-section"><h3>${a.name}</h3>
      <div class="plan-preview" style="height:200px;background:${a.color};border:2px solid var(--fg-ink);margin-bottom:16px"></div>
      <p class="setting-hint">类型：${a.type}　日期：${a.date}　标记：${a.tag}<br />引用关系：被 2 个剪辑工程引用，删除前需先解除引用。</p>
    </div>
    <div class="drawer-section"><h3>可执行操作</h3><div class="drawer-row">
      <button type="button" class="big-btn" data-asset-act="studio">送入创作</button>
      <button type="button" class="big-btn" data-asset-act="clip">送入剪辑</button>
      <button type="button" class="big-btn" data-asset-act="download">下载原素材</button>
    </div></div>
    <div class="drawer-section"><h3>衍生版本</h3><p class="setting-hint">共 3 个衍生版本，包含精修图与不同画幅。智能分类标签：室内 / 客厅 / 暖木色系。</p></div>`;
}
function renderServiceDrawer() {
  return `<div class="drawer-section"><h3>剪辑服务</h3><p class="setting-hint">剪辑编辑器是独立运行的子应用。未就绪时工作台会显示红色钟摆提示，点击「打开服务控制台」启动即可，页面会自动重新连接，不需要刷新。</p></div>
    <div class="drawer-section"><h3>诊断</h3><p class="setting-hint">连接状态：待启动<br />网关：本机工作台<br />用户可见地址：仅工作台入口，不展示内部服务地址。</p></div>
    <button type="button" class="big-btn primary" id="service-start" style="width:100%">启动剪辑服务</button>`;
}
function bindDrawer() {
  $$('[data-theme]').forEach(b => b.onclick = () => { setTheme(b.dataset.theme, true); openDrawer('display','显示设置'); });
  $$('[data-size]').forEach(b => b.onclick = () => {
    const size = b.dataset.size;
    html.classList.toggle('senior-mode', size !== 'normal');
    html.classList.toggle('super-mode', size === 'super');
    localStorage.setItem('workbench_size', size);
    toast({ normal:'已切换到标准大小', senior:'已开启适老化大字模式', super:'已开启超大字模式' }[size]);
    openDrawer('display','显示设置');
  });
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
  $$('[data-param]').forEach(b => b.onclick = () => {
    $$('[data-param]').forEach(x => { if (x.dataset.param === b.dataset.param) x.classList.remove('is-on'); });
    b.classList.add('is-on'); toast(`已设置：${b.textContent.trim()}`);
  });
  $$('[data-asset-act]').forEach(b => b.onclick = () => {
    const act = b.dataset.assetAct;
    closeDrawer();
    if (act === 'studio') { switchView('studio'); toast('已把素材挂载到创作输入舱'); }
    else if (act === 'clip') { switchView('clip'); toast('已把素材送入剪辑素材箱'); }
    else toast('已开始下载原素材');
  });
  $('#service-start')?.addEventListener('click', () => { closeDrawer(); $('#service-warn').hidden = true; toast('剪辑服务已启动，页面已重新连接'); updateLoopStatus(); });
  checkLocalAssets();
}
function checkLocalAssets() {
  const box = $('#asset-check'); if (!box) return;
  const external = performance.getEntriesByType('resource').map(r => r.name)
    .filter(u => /^https?:\/\//i.test(u) && !u.startsWith(location.origin));
  box.textContent = `本地字体 6 个 · 本地图标 ${Object.keys(ICONS).length} 个 · 外部链接 ${external.length} 个 · ${external.length ? '发现外链，请检查' : '断网可用'}`;
}

/* ------------------------------------------------------------ 顶栏 / 板块切换 */
$('#main-nav').innerHTML = NAV.map((n,i) => `
  <button type="button" class="nav-btn${i===0?' is-on':''}" data-view="${n.key}" title="${n.desc}">
    <span class="nav-idx">0${i+1}</span>${n.label}
  </button>`).join('');

function switchView(key, animate = true) {
  const apply = () => {
    state.view = key;
    $$('.nav-btn').forEach(b => b.classList.toggle('is-on', b.dataset.view === key));
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== key; });
    renderSide();
    $('#top-stat').textContent = key === 'assets' ? '共 88 项资产 · 3713 帧'
      : key === 'studio' ? '当前会话 · 现代客厅软装方案'
      : key === 'clip' ? '当前工程 · 秋季方案成片'
      : '本机工作台 · 设置';
    stagger($(`.view[data-view="${key}"]`));
    updateLoopStatus();
    const label = NAV.find(n => n.key === key)?.label;
    if (label) history.replaceState(null, '', `#${label}`); // 板块可直达、可分享
  };
  if (animate && !reduced() && document.startViewTransition) {
    const vt = document.startViewTransition(apply); vt.finished?.catch(() => {});
  } else apply();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

function stagger(root) {
  if (!root || reduced()) return;
  const items = $$('.enter', root);
  items.forEach((el,i) => {
    el.classList.remove('is-in');
    setTimeout(() => el.classList.add('is-in'), Math.min(i,5) * 40);
  });
}

/* ------------------------------------------------------------ 左侧分区 */
function renderSide() {
  const side = $('#side');
  if (state.view === 'assets') {
    side.innerHTML = `<p class="side-title">资产分区</p>` + LANES.map(l => `
      <button type="button" class="side-link${l.key===state.lane?' is-on':''}" data-lane="${l.key}">
        <span>${l.label}</span><span class="side-count">${l.count}</span>
      </button>`).join('') + `<div class="side-foot">常用操作在顶部工具条<br />高级筛选收在抽屉里<br />批量操作选中后出现</div>`;
    $$('[data-lane]').forEach(b => b.onclick = () => {
      state.lane = b.dataset.lane;
      $$('[data-lane]').forEach(x => x.classList.toggle('is-on', x === b));
      const label = LANES.find(l => l.key === state.lane).label;
      toast(`已切换到：${label}`);
      renderAssets();
    });
  } else if (state.view === 'studio') {
    side.innerHTML = `<p class="side-title">会话</p>` + CHATS.map(g => `
      <p class="side-group">${g.group}</p>` + g.items.map((t,i) => `
        <button type="button" class="side-link${g.group==='今天'&&i===0?' is-on':''}" data-chat="${t}"><span>${t}</span></button>`).join('')).join('')
      + `<button type="button" class="big-btn primary side-new" id="new-chat">新建对话</button>
         <div class="side-foot">创作库在左侧「新建对话」旁<br />常用模式常驻输入舱<br />参数收在抽屉里</div>`;
    $$('[data-chat]').forEach(b => b.onclick = () => {
      $$('[data-chat]').forEach(x => x.classList.toggle('is-on', x === b));
      toast(`已打开会话：${b.dataset.chat}`);
    });
    $('#new-chat').onclick = () => { $('#prompt-input').value = ''; $('#prompt-input').focus(); toast('已新建对话'); };
  } else if (state.view === 'clip') {
    side.innerHTML = `<p class="side-title">剪辑分区</p>
      <button type="button" class="side-link is-on" data-clipside="timeline"><span>多轨剪辑</span><span class="side-count">1</span></button>
      <button type="button" class="side-link" data-clipside="tools"><span>媒体工具</span><span class="side-count">3</span></button>
      <button type="button" class="side-link" data-clipside="project"><span>工程列表</span><span class="side-count">9</span></button>
      <div class="side-foot">剪辑编辑器独立运行<br />工程保存在本机<br />支持导出与云端快照</div>`;
    $$('[data-clipside]').forEach(b => b.onclick = () => {
      $$('[data-clipside]').forEach(x => x.classList.toggle('is-on', x === b));
      if (b.dataset.clipside === 'tools') switchClip('tools');
      else { switchClip('timeline'); toast(b.dataset.clipside === 'project' ? '已打开工程列表' : '已切换到多轨剪辑'); }
    });
  } else {
    side.innerHTML = `<p class="side-title">设置分组</p>` + SETTINGS_GROUPS.map(g => `
      <button type="button" class="side-link${g.key===state.setting?' is-on':''}" data-set="${g.key}" title="${g.desc}">
        <span>${g.label}</span>
      </button>`).join('') + `<div class="side-foot">一次只显示一个模块<br />低频管理项收在这里<br />支持设置内搜索</div>`;
    $$('[data-set]').forEach(b => b.onclick = () => {
      state.setting = b.dataset.set;
      $$('[data-set]').forEach(x => x.classList.toggle('is-on', x === b));
      renderSettings();
    });
  }
}

/* ------------------------------------------------------------ 资产 */
function laneAssets() {
  const map = { image:'图片', video:'视频', audio:'音频', base:'基础素材' };
  const t = map[state.lane];
  return t ? ASSETS.filter(a => a.type === t) : ASSETS;
}
function renderAssets() {
  const list = laneAssets();
  $('#asset-count').textContent = `共 ${list.length} 项`;
  $('#asset-grid').innerHTML = list.map(a => `
    <article class="asset-card enter${state.selected.has(a.id)?' is-selected':''}" data-id="${a.id}">
      <div class="asset-thumb" style="background:${a.color}">
        <span class="sel-check" aria-hidden="true"></span>
        <span class="thumb-mark"></span>
        <span class="asset-tag">${a.tag}</span>
        <span class="thumb-lines"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="asset-body"><strong>${a.name}</strong>
        <div class="card-meta"><span>${a.type} · ${a.date}</span><span>已入库</span></div>
      </div>
      <div class="asset-actions">
        <button type="button" data-act="detail" title="查看资产详情">详情</button>
        <button type="button" data-act="studio" title="送入创作">创作</button>
        <button type="button" data-act="clip" title="送入剪辑">剪辑</button>
        <button type="button" data-act="download" title="下载原素材">下载</button>
      </div>
    </article>`).join('');
  $$('.asset-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const id = +card.dataset.id;
      if (state.selectMode) { toggleSelect(id); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'detail') { state.currentAsset = id; openDrawer('asset','资产详情'); }
      else if (act === 'studio') { switchView('studio'); toast('已把素材挂载到创作输入舱'); }
      else if (act === 'clip') { switchView('clip'); toast('已把素材送入剪辑素材箱'); }
      else toast('已开始下载原素材');
    });
  });
  stagger($('#asset-grid'));
}
function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  $$('.asset-card').forEach(c => c.classList.toggle('is-selected', state.selected.has(+c.dataset.id)));
  $('#sel-count').textContent = `已选 ${state.selected.size} 项`;
}
$('#btn-multi').addEventListener('click', (e) => {
  state.selectMode = !state.selectMode;
  $('#asset-grid').classList.toggle('select-mode', state.selectMode);
  $('#sel-dock').hidden = !state.selectMode;
  e.currentTarget.classList.toggle('is-on', state.selectMode);
  e.currentTarget.textContent = state.selectMode ? '退出多选' : '多选';
  if (!state.selectMode) { state.selected.clear(); renderAssets(); }
});
$$('[data-sel]').forEach(b => b.onclick = () => {
  const a = b.dataset.sel;
  if (a === 'all') { laneAssets().forEach(x => state.selected.add(x.id)); renderAssets(); $('#sel-count').textContent = `已选 ${state.selected.size} 项`; }
  else if (a === 'invert') { const all = laneAssets(); all.forEach(x => state.selected.has(x.id) ? state.selected.delete(x.id) : state.selected.add(x.id)); renderAssets(); $('#sel-count').textContent = `已选 ${state.selected.size} 项`; }
  else if (a === 'clear') { state.selected.clear(); renderAssets(); $('#sel-count').textContent = '已选 0 项'; }
  else if (a === 'studio') { switchView('studio'); toast(`已把 ${state.selected.size} 项素材送入创作`); }
  else if (a === 'clip') { switchView('clip'); toast(`已把 ${state.selected.size} 项素材送入剪辑`); }
  else toast(`已提交 ${state.selected.size} 项删除请求，被工程引用的素材会被拦截`);
});
$('#btn-filter').onclick = () => openDrawer('filter','筛选条件');
$('#btn-layout').onclick = (e) => { e.currentTarget.textContent = e.currentTarget.textContent === '切换视图' ? '已切换为列表' : '切换视图'; toast('已切换资产排列方式'); };
$('#btn-upload').onclick = $('#btn-upload-2').onclick = () => toast('已打开本地文件上传');
$('#btn-display').onclick = () => openDrawer('display','显示设置');
$('#btn-user').onclick = () => toast('当前登录：管理员');
$('#global-search').addEventListener('keydown', e => { if (e.key === 'Enter' && e.currentTarget.value.trim()) toast(`搜索：${e.currentTarget.value.trim()}`); });
$('#search-icon').innerHTML = svg('search', 26);

/* ------------------------------------------------------------ 创作 */
$('#mode-row').innerHTML = MODES.map((m,i) => `<button type="button" class="mode-btn${i===0?' is-on':''}" data-mode="${m.key}">${m.label}</button>`).join('');
$$('[data-mode]').forEach(b => b.onclick = () => {
  $$('[data-mode]').forEach(x => x.classList.toggle('is-on', x === b));
  state.mode = b.dataset.mode;
  toast(`已切换到：${b.textContent}`);
});
function renderMessages() {
  $('#chat-scroll').innerHTML = MESSAGES.map(m => {
    if (m.role === 'asset') return `<div class="msg-assets enter"><div class="mini-thumbs"><i style="background:#C9BFA8"></i><i style="background:#8B6A45"></i><i style="background:#D8C9AE"></i></div><div><strong>${m.text}</strong><br /><span class="card-meta">点击查看大图、对比或送入剪辑</span></div></div>`;
    return `<div class="msg ${m.role === 'me' ? 'me' : ''} enter"><span class="msg-who">${m.role === 'me' ? '我' : '智能助手'}</span>${m.text}</div>`;
  }).join('');
  stagger($('#chat-scroll'));
}
$('#btn-send').onclick = () => {
  const v = $('#prompt-input').value.trim();
  if (!v) { toast('请先描述想要的效果'); $('#prompt-input').focus(); return; }
  MESSAGES.push({ role:'me', text:v });
  $('#prompt-input').value = '';
  renderMessages();
  toast('已提交生成任务');
  setTimeout(() => {
    MESSAGES.push({ role:'ai', text:'已收到描述，正在按当前参数生成。完成后会给出衍生版本，可直接送入剪辑轨道。' });
    renderMessages();
    $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
  }, 900);
  $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
};
$('#btn-params').onclick = () => openDrawer('params','生成参数');
$('#btn-ref').onclick = () => toast('已打开资产引用列表');
$('#btn-attach').onclick = () => toast('可从「资产」多选后一键挂载');
$('#btn-optimize').onclick = () => { const t = $('#prompt-input'); t.value = t.value.replace(/。?$/, '，保留原有采光与构图，输出 4 个衍生版本。'); toast('已补充约束条件'); };
$('#btn-voice').onclick = $('#btn-voice-2').onclick = () => toast('语音输入已就绪，请开始说话');
$$('.chip').forEach(c => c.onclick = () => { $('#prompt-input').value = c.textContent; $('#prompt-input').focus(); });

/* ------------------------------------------------------------ 剪辑 */
function switchClip(which) {
  state.clip = which;
  $('#clip-timeline').hidden = which !== 'timeline';
  $('#clip-tools').hidden = which !== 'tools';
  $$('#clip-subnav .big-btn').forEach(b => b.classList.toggle('is-on', b.dataset.clip === which));
  $$('[data-clipside]').forEach(b => { if (b.dataset.clipside === which) b.classList.add('is-on'); });
  stagger($(which === 'timeline' ? '#clip-timeline' : '#clip-tools'));
  updateLoopStatus();
}
$$('#clip-subnav .big-btn').forEach(b => b.onclick = () => switchClip(b.dataset.clip));
$('#timeline-ruler').innerHTML = Array.from({length:12},(_,i)=>`<span>${String(i*5).padStart(2,'0')}秒</span>`).join('');
$('#timeline-tracks').innerHTML = TIMELINE.map(t => `
  <div class="track"><span class="track-name">${t.name}</span><div class="track-lane">
    ${t.clips.map(c => `<span class="track-clip" style="border-color:${t.color};color:${t.color}">${c}</span>`).join('')}
  </div></div>`).join('');
$('#tool-cards').innerHTML = CLIP_TOOLS.map(t => `
  <article class="tool-card enter"><h2>${t.name}</h2><p>${t.desc}</p>
    <ul>${t.points.map(p => `<li>${p}</li>`).join('')}</ul>
    <button type="button" class="big-btn" data-tool="${t.name}">打开${t.name}</button>
  </article>`).join('');
$$('[data-tool]').forEach(b => b.onclick = () => toast(`已打开：${b.dataset.tool}`));
$('#btn-warn-close').onclick = () => { $('#service-warn').hidden = true; toast('已收起提示，可在服务控制台查看状态'); updateLoopStatus(); };
$('#btn-service').onclick = () => openDrawer('service','服务控制台');

/* 播放 / 暂停：本地 morphicons 形变 */
(function initPlayMorph(){
  const holder = $('#play-icon');
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${iconPath('play')}" fill="currentColor"/></svg>`;
  const path = $('path', holder);
  let engine = null;
  try { engine = createMorph(path, iconPath('play'), { reducedMotion:'user', strokeWidth:2 }); } catch {}
  $('#btn-play').onclick = () => {
    state.playing = !state.playing;
    const next = state.playing ? 'pause' : 'play';
    try { if (engine) engine.morphTo(iconPath(next)); else path.setAttribute('d', iconPath(next)); }
    catch { path.setAttribute('d', iconPath(next)); }
    $('#btn-play').lastChild.textContent = state.playing ? ' 暂停' : ' 播放';
  };
})();

/* ------------------------------------------------------------ 设置 / 标识 */
function renderSettings() {
  const g = SETTINGS_GROUPS.find(x => x.key === state.setting);
  $('#setting-current').textContent = `当前：${g.label}`;
  const panel = $('#setting-panel');
  if (state.setting === 'brand') {
    panel.innerHTML = `
      <h2>品牌标识</h2><p>${g.desc}。点击任一方案即可换到顶栏试看，缩到小尺寸与单色印刷的效果也能同时检查。</p>
      <div class="logo-plans">${LOGO_PLANS.map(p => `
        <article class="logo-plan enter${p.key===state.logo?' is-current':''}" data-key="${p.key}">
          <div class="plan-preview">${p.svg}</div>
          <h3>${p.name} ${p.recommended?'<span class="plan-rec">推荐</span>':''}</h3>
          <p><strong>概念：</strong>${p.idea}</p><p><strong>依据：</strong>${p.why}</p><p><strong>适用：</strong>${p.use}</p>
          <p><strong>小尺寸：</strong><span class="plan-mini">${p.svg}</span> 24 像素下仍可辨认</p>
          <button type="button" class="big-btn plan-btn${p.key===state.logo?' is-on':''}" data-logo="${p.key}">${p.key===state.logo?'当前使用':'设为当前标识'}</button>
        </article>`).join('')}</div>
      <h2>单色适配</h2><p>去掉信号橙后仍要成立，才能用于印章、传真与黑白印刷。</p>
      <div class="mono-sample" style="--logo-accent:currentColor">${LOGO_PLANS[0].svg}<span>四分格 · 单色版</span></div>
      <h2>设计流程与取舍</h2>
      <table class="method-table"><thead><tr><th>环节</th><th>做法</th><th>本项目</th></tr></thead><tbody>
        ${LOGO_METHOD.map(([a,b,c]) => `<tr><td>${a}</td><td>${b}</td><td class="${c.startsWith('未')?'no':''}">${c}</td></tr>`).join('')}
      </tbody></table>
      <h2>参考方案对比</h2>
      <table class="method-table"><thead><tr><th>方案</th><th>特点</th><th>取舍</th></tr></thead><tbody>
        ${LOGO_REFS.map(([a,b,c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}
      </tbody></table>`;
    $$('[data-logo]').forEach(b => b.onclick = () => { setLogo(b.dataset.logo); toast(`已切换标识：${LOGO_PLANS.find(p=>p.key===b.dataset.logo).name}`); });
    stagger(panel);
    return;
  }
  const fields = SETTING_FIELDS[state.setting] || [];
  panel.innerHTML = `<h2>${g.label}</h2><p>${g.desc}。</p><div class="field-list">${fields.map(([label,val,type]) => `
    <div class="field enter"><label>${label}</label>${
      type === '开关' ? `<button type="button" class="switch" aria-pressed="${val==='开启'||val.includes('开启')}" data-switch="${label}">${val}</button>`
      : type === '状态' ? `<span class="field-status">${val}</span>`
      : type === '下拉' ? `<select>${[val,'更多选项一','更多选项二'].map(x=>`<option>${x}</option>`).join('')}</select>`
      : `<input type="${type==='数值'?'number':'text'}" value="${val}" />`
    }</div>`).join('')}</div>
    <div class="save-row"><button type="button" class="big-btn primary" id="btn-save">保存设置</button><button type="button" class="big-btn" id="btn-reset">恢复默认</button></div>`;
  $$('[data-switch]').forEach(b => b.onclick = () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '开启' : '关闭';
  });
  $('#btn-save').onclick = () => toast(`${g.label}设置已保存并立即生效`);
  $('#btn-reset').onclick = () => { renderSettings(); toast('已恢复默认设置'); };
  stagger(panel);
}

/* ------------------------------------------------------------ 循环预算 / 降级 */
function updateLoopStatus() {
  let n = 0;
  if (!reduced() && !html.classList.contains('motion-off')) {
    if (!$('#service-warn').hidden && state.view === 'clip' && state.clip === 'timeline') n++;
    n++; // 底部状态栏步进
  }
  $('#loop-status').textContent = `循环动效 ${n} / 2`;
}
function updateRM() {
  $('#rm-status').textContent = `减少动态效果：${reduced() ? '开' : '关'}`;
  updateLoopStatus();
}
rmQuery.addEventListener?.('change', updateRM);
document.addEventListener('visibilitychange', updateLoopStatus);

/* ------------------------------------------------------------ 初始化 */
setTheme(state.theme);
const savedSize = localStorage.getItem('workbench_size') || 'senior';
html.classList.toggle('senior-mode', savedSize !== 'normal');
html.classList.toggle('super-mode', savedSize === 'super');
setLogo(state.logo);
renderSide();
renderAssets();
renderMessages();
// 支持 #资产 / #创作 / #剪辑 / #设置 直达；?brand 直达标识方案页
const HASH_VIEW = { '#资产':'assets', '#创作':'studio', '#剪辑':'clip', '#设置':'settings' };
const initialView = HASH_VIEW[decodeURIComponent(location.hash || '')];
const query = decodeURIComponent(location.search || '');
if (/brand/i.test(query) || query.includes('品牌')) {
  state.setting = 'brand';
  switchView('settings', false);
} else if (initialView && initialView !== 'assets') {
  switchView(initialView, false);
}
renderSettings();
setTimeout(() => { stagger($('.view[data-view="' + state.view + '"]')); updateRM(); }, 60);
