/* STYLEKIT MOTION LAB · 交互层（零外部依赖，全部相对路径） */
import { ICONS, MORPH_PAIRS, iconPath } from './icons.js';
import { SPOTS, GROUPS, NO_MOTION, INSPIRATION, SKILLS, THEMES } from './data.js';
import { ASSETS } from './assets-data.js';
import { createMorph } from './vendor/morphicons/dom.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const html = document.documentElement;
const rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => rmQuery.matches;
let loopOf = {}; // 提前声明：updateBudget 可能在循环模块初始化前就被调用

/* ------------------------------------------------------------ 主题 / 适老 / 总暂停 */
function setTheme(key, persist = true, animate = false) {
  const apply = () => {
    html.classList.remove('eye-care', 'light', 'dark');
    html.classList.add(key);
  };
  if (animate && !reduced() && document.startViewTransition) {
    const vt = document.startViewTransition(apply);
    vt.finished?.catch(() => {}); // 快速连续切换时旧 transition 会被跳过
  } else apply();
  $$('.seg-btn').forEach(b => b.setAttribute('aria-checked', String(b.dataset.theme === key)));
  $$('.theme-card').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.key === key)));
  if (persist) localStorage.setItem('demo_stylekit_theme', key); // 不碰项目的 material_theme
}
$$('.seg-btn').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme, true, true)));
setTheme(localStorage.getItem('demo_stylekit_theme') || 'eye-care', false);

$('#btn-senior').addEventListener('click', (e) => {
  const on = !html.classList.contains('senior-mode');
  html.classList.toggle('senior-mode', on);
  e.currentTarget.textContent = on ? '适老 ON' : '适老 OFF';
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

$('#btn-motion').addEventListener('click', (e) => {
  const off = !html.classList.contains('motion-off');
  html.classList.toggle('motion-off', off);
  e.currentTarget.textContent = off ? '恢复动效' : '全部暂停';
  e.currentTarget.setAttribute('aria-pressed', String(off));
  updateBudget();
});

function updateRM() {
  $('#rm-status').textContent = `REDUCED: ${reduced() ? 'ON' : 'OFF'}`;
  updateBudget();
}
rmQuery.addEventListener?.('change', updateRM);
updateRM();

/* ------------------------------------------------------------ 目录 / 入场 */
const links = $$('.side-link');
const sections = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
const navObserver = new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    links.forEach(a => a.classList.toggle('is-on', a.getAttribute('href') === `#${en.target.id}`));
  });
}, { rootMargin: '-20% 0px -70% 0px' });
sections.forEach(s => navObserver.observe(s));

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (en.isIntersecting) en.target.classList.add('is-in');
  });
}, { threshold: .2 });
$$('.reveal-line, .reveal-mask').forEach(el => revealObserver.observe(el));

const WORDS = ['STANDBY', 'LIVE', '0 / 0', 'RENDER', 'QUEUED'];
let wordIdx = 0;
function playReveal() {
  const mask = $('.reveal-mask');
  $('#reveal-word').textContent = WORDS[wordIdx++ % WORDS.length];
  mask.classList.remove('is-in');
  requestAnimationFrame(() => requestAnimationFrame(() => mask.classList.add('is-in')));
}
$('#btn-reveal').addEventListener('click', playReveal);
// 首屏巨字与遮罩词不依赖 IntersectionObserver，保证任何渲染时机都可见
requestAnimationFrame(() => $$('.hero .reveal-line').forEach(el => el.classList.add('is-in')));
playReveal();
$('#btn-tour').addEventListener('click', () => {
  $$('.reveal-line').forEach((el, i) => {
    el.classList.remove('is-in');
    setTimeout(() => el.classList.add('is-in'), i * 40); // stagger 上限 6 项
  });
  playReveal();
  $('#s00').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
});

$('#btn-sweep').addEventListener('click', () => {
  const t = $('.sweep-target');
  t.classList.remove('is-sweep');
  void t.offsetWidth;
  t.classList.add('is-sweep');
  setTimeout(() => t.classList.remove('is-sweep'), 800);
});

/* ------------------------------------------------------------ 循环动效预算 */
loopOf = {
  orbit: $('.canvas-orbit .kc-loop'),
  pendulum: $('.canvas-pendulum .kc-loop'),
  march: $('.canvas-march .kc-loop'),
  wght: $('.canvas-weight .kc-loop'),
};
// 默认只跑 2 个循环：orbit + march。其余为「播放」状态由用户开启。
['pendulum', 'wght'].forEach(k => loopOf[k].classList.add('is-paused'));
const visibleLoops = new Set();
const loopObserver = new IntersectionObserver((entries) => {
  entries.forEach(en => {
    if (en.isIntersecting) visibleLoops.add(en.target); else visibleLoops.delete(en.target);
  });
  updateBudget();
}, { threshold: .15 });
Object.values(loopOf).forEach(el => loopObserver.observe(el));

function runningLoops() {
  if (!Object.keys(loopOf).length || reduced() || html.classList.contains('motion-off')) return 0;
  return Object.values(loopOf).filter(el => !el.classList.contains('is-paused') && visibleLoops.has(el)).length;
}
function updateBudget() {
  const n = runningLoops();
  $('#budget-fill').style.transform = `scaleX(${Math.min(n / 2, 1)})`;
  $('#budget-fill').style.background = n > 2 ? 'var(--kc-red)' : 'var(--kc-blue)';
  $('#budget-text').textContent = `${n} / 2 运行中`;
  $('#budget-warn').textContent = n > 2 ? '超出预算 · 请暂停其它循环' : '';
}
$$('[data-toggle]').forEach(btn => btn.addEventListener('click', () => {
  const el = loopOf[btn.dataset.toggle];
  const paused = el.classList.toggle('is-paused');
  btn.textContent = paused ? '播放' : '暂停';
  btn.setAttribute('aria-pressed', String(!paused));
  updateBudget();
}));
$$('[data-toggle]').forEach(btn => {
  const paused = loopOf[btn.dataset.toggle].classList.contains('is-paused');
  btn.textContent = paused ? '播放' : '暂停';
  btn.setAttribute('aria-pressed', String(!paused));
});
document.addEventListener('visibilitychange', updateBudget);
setTimeout(updateBudget, 120);

/* ------------------------------------------------------------ 01 三态色板 */
$('#theme-grid').innerHTML = THEMES.map(t => `
  <button type="button" class="theme-card" data-key="${t.key}" aria-pressed="false"
          style="background:${t.surface};color:${t.ink}">
    <span class="theme-swatch" style="background:${t.stage}">
      <i style="background:${t.stage};border-color:${t.ink}"></i>
      <i style="background:${t.surface};border-color:${t.ink}"></i>
      <i style="background:${t.ink};border-color:${t.ink}"></i>
      <i style="background:#FF4D00;border-color:${t.ink}"></i>
    </span>
    <span class="tc-body">
      <span class="tc-title">${t.label}</span>
      <span class="tc-desc mono">${t.en}</span>
      <span class="theme-vars mono">
        <span>STAGE <b>${t.stage}</b></span>
        <span>SURFACE <b>${t.surface}</b></span>
        <span>INK <b>${t.ink}</b></span>
        <span>MUTED <b>${t.muted}</b></span>
      </span>
    </span>
  </button>`).join('');
$$('.theme-card').forEach(c => c.addEventListener('click', () => setTheme(c.dataset.key, true, true)));
setTheme(localStorage.getItem('demo_stylekit_theme') || 'eye-care', false);

/* ------------------------------------------------------------ 02 字阶 */
const SCALE = [
  ['DISPLAY','clamp(2.75rem, 7vw, 6.5rem)','仅空状态 / 切换瞬时，中文行高 ≥1.05'],
  ['H2','clamp(2rem, 4.5vw, 4.25rem)','章节标题，左对齐'],
  ['H3','24–28px','区块小标题'],
  ['BODY','16–17px','行高 ≥1.6，中文不用等宽'],
  ['ANNOTATION','13–15px','只给数字/英文；中文标注字距 ≤0.06em'],
  ['TOUCH','≥44×44px','主 CTA ≥48px 高'],
];
$('#type-scale').innerHTML = SCALE.map(([k,v,d]) => `
  <div class="scale-cell"><span class="mono">${k}</span><strong>${v}</strong><p>${d}</p></div>`).join('');

/* ------------------------------------------------------------ 04 morphicons 形变 */
const SVG_NS = 'http://www.w3.org/2000/svg';
function makeSvg(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return { svg, path: p };
}
const MORPH_DEMOS = [
  ['play','pause','播放 / 暂停','双向'],
  ['plus','check','勾选','单向'],
  ['copy','check','复制完成','单向'],
  ['moon','sun','主题切换','双向'],
  ['wand','sparkles','AI 状态','双向'],
  ['eye','eyeOff','显隐','双向'],
];
$('#morph-bar').innerHTML = MORPH_DEMOS.map(([a,b,label,dir],i) => `
  <div class="morph-item" data-i="${i}">
    <span class="morph-slot"></span>
    <button type="button">切换</button>
    <span><span class="mono">${a} → ${b}</span><br /><span class="mono cn">${label} · ${dir}</span></span>
  </div>`).join('');

$$('.morph-item').forEach(item => {
  const i = +item.dataset.i;
  const [a, b] = MORPH_DEMOS[i];
  const { svg, path } = makeSvg(iconPath(a));
  $('.morph-slot', item).appendChild(svg);
  let current = a, engine = null;
  try {
    engine = createMorph(path, iconPath(a), { reducedMotion: 'user', strokeWidth: 2 });
  } catch (err) {
    console.warn('[morphicons] 降级为直接替换 path：', err.message);
  }
  $('button', item).addEventListener('click', () => {
    const next = current === a ? b : a;
    try {
      if (engine) engine.morphTo(iconPath(next));
      else path.setAttribute('d', iconPath(next));
    } catch {
      path.setAttribute('d', iconPath(next));
    }
    current = next;
  });
});

const iconNames = Object.keys(ICONS);
$('#icon-count').textContent = `${iconNames.length} ICONS / ${Object.keys(MORPH_PAIRS).length} PAIRS`;
$('#icon-grid').innerHTML = iconNames.map(n => `
  <div class="icon-cell" title="${n}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}" fill="currentColor" stroke="currentColor" stroke-width=".8" stroke-linejoin="round"/></svg>
    <span class="mono">${n}</span>
  </div>`).join('');

/* ------------------------------------------------------------ 05 IA 处方 */
const RX = [
  ['TopNav.vue','6 泳道从 hover 下拉改为左侧竖向常驻导航，行高 ≥44px；hover 只作快捷方式'],
  ['LibraryView.vue','顶部只留 搜索 / 上传 / 视图 / 筛选 4 个动作；4 套筛选区合并为一个抽屉'],
  ['ChatStudio.vue','输入舱常驻层 ≤6 控件；模型 / 参数 / 技能 / 预览请求收进参数抽屉，当前模型名常显'],
  ['QuickStudio.vue','6 大模式提到左侧常置模式条，右抽屉只渲染当前模式参数'],
  ['SettingsView.vue','11 个模块一个不少，改左导航 + 右单模块，分 5 组并加设置内搜索'],
  ['App.vue','四视图改 keep-alive，切板块不销毁 OpenCut iframe；循环动画随隐藏暂停'],
];
$('#prescription').innerHTML = RX.map(([f,t]) => `
  <div class="rx"><span class="mono">${f}</span><h4>只挪位置，不删功能</h4><p>${t}</p></div>`).join('');

/* ------------------------------------------------------------ 06 落点地图 */
let spotFilter = 'ALL';
const filterDefs = [['ALL','全部 35'], ...Object.entries(GROUPS).map(([k,v]) => [k,v]), ['A','预算 A'], ['B','预算 B'], ['C','预算 C']];
$('#spot-filters').innerHTML = filterDefs.map(([k,v]) =>
  `<button type="button" class="filter-btn${k === 'ALL' ? ' is-on' : ''}" data-f="${k}">${v}</button>`).join('');
function renderSpots() {
  const list = SPOTS.filter(s => spotFilter === 'ALL' || s.g === spotFilter || s.b === spotFilter);
  $('#spot-body').innerHTML = list.map(s => `
    <tr>
      <td class="mono">${String(s.id).padStart(2,'0')}</td>
      <td><strong>${s.n}</strong><span class="mono">${s.l}</span></td>
      <td>${s.t}</td><td>${s.k}</td><td class="mono">${s.m}</td>
      <td><span class="badge ${s.b}">${s.b}</span></td>
      <td>${s.f}</td>
    </tr>`).join('') || `<tr><td colspan="7">无匹配落点</td></tr>`;
}
$$('.filter-btn').forEach(b => b.addEventListener('click', () => {
  spotFilter = b.dataset.f;
  $$('.filter-btn').forEach(x => x.classList.toggle('is-on', x === b));
  renderSpots();
}));
renderSpots();
$('#no-go').innerHTML = NO_MOTION.map(([n,l,why]) => `
  <div><strong>${n}</strong><span class="mono">${l}</span><p>${why}</p></div>`).join('');

/* ------------------------------------------------------------ 07 灵感 / 技能 */
$('#inspo-list').innerHTML = INSPIRATION.map(([n,src,what,take]) => `
  <div class="inspo-row">
    <strong>${n}</strong><span class="mono">${src}</span><p>${what}</p><p class="take mono cn">${take}</p>
  </div>`).join('');
$('#skill-list').innerHTML = SKILLS.map(([n,id,d]) => `
  <div class="skill-card"><span class="mono">${id}</span><strong>${n}</strong><p>${d}</p></div>`).join('');

/* ------------------------------------------------------------ 08 本地资源 / 零外链自检 */
const fontBytes = ASSETS.fonts.reduce((s,f) => s + f.bytes, 0);
const vendorBytes = ASSETS.vendor.reduce((s,f) => s + f.bytes, 0);
const kb = n => `${(n/1024).toFixed(1)} KB`;
$('#asset-summary').innerHTML = `
  <div><span class="mono">FONTS / LOCAL</span><strong>${ASSETS.fonts.length}</strong><p>${kb(fontBytes)} · latin woff2 子集</p></div>
  <div><span class="mono">ICONS / LOCAL</span><strong>${ASSETS.icons.count}</strong><p>项目 StudioIcon.vue 原样抽取</p></div>
  <div><span class="mono">RUNTIME / LOCAL</span><strong>${ASSETS.vendor.length}</strong><p>${kb(vendorBytes)} · ${ASSETS.vendorLicense}</p></div>
  <div><span class="mono">EXTERNAL URL</span><strong>0</strong><p>页面运行时零 CDN</p></div>`;

$('#asset-list').innerHTML = `
  <div class="asset-col"><span class="mono">FONT FILES · fonts/</span><ul>${ASSETS.fonts.map(f =>
    `<li>${f.file} <span class="mono">${f.family} ${f.weight} · ${kb(f.bytes)}</span></li>`).join('')}</ul></div>
  <div class="asset-col"><span class="mono">MORPHICONS ESM · vendor/morphicons/</span><ul>${ASSETS.vendor.slice(0,8).map(f =>
    `<li>${f.file} <span class="mono">${kb(f.bytes)}</span></li>`).join('')}<li>… 共 ${ASSETS.vendor.length} 个 ESM + LICENSE</li></ul>
    <p class="mono" style="margin-top:12px;color:var(--fg-muted)">${ASSETS.notes.join(' / ')}</p></div>`;

function selfCheck() {
  const nodes = $$('link[href], script[src], img[src], iframe[src]');
  const bad = nodes.map(n => n.getAttribute('href') || n.getAttribute('src'))
    .filter(u => /^(https?:)?\/\//i.test(u || ''));
  const loadedExternal = performance.getEntriesByType('resource')
    .map(r => r.name).filter(u => /^https?:\/\//i.test(u) && !u.startsWith(location.origin));
  const allBad = [...new Set([...bad, ...loadedExternal])];
  const box = $('#selfcheck');
  box.className = `selfcheck ${allBad.length ? 'fail' : 'ok'}`;
  box.innerHTML = `<span class="mono">RUNTIME SELF-CHECK / ${new Date().toLocaleTimeString('zh-CN')}</span>
    <p>${allBad.length ? `发现 ${allBad.length} 个外部 URL` : '通过 · 页面无外部 URL，断网即可用'}</p>
    <span class="mono">${allBad.length ? allBad.join(' / ') : `已加载 ${performance.getEntriesByType('resource').length} 个本地资源`}</span>`;
}
// 等字体与 ESM 都加载完再自检
if (document.fonts?.ready) document.fonts.ready.then(() => setTimeout(selfCheck, 200));
else window.addEventListener('load', () => setTimeout(selfCheck, 200));
