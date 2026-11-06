/**
 * MATERIAL STUDIO PRO · 设计 Demo 本地资源拉取脚本
 * ------------------------------------------------------------------
 * 把「文字（字体）」「图标」「图标形变运行时」全部拉到本项目本地，
 * demo 页面将完全不引用任何 CDN / 外部 URL。
 *
 * 运行： node demos/stylekit-motion/scripts/pull-assets.mjs
 * 产物： fonts/*.woff2 · fonts.css · icons.js · vendor/morphicons/*.js · assets-manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..');
const PROJECT = path.resolve(DEMO, '..', '..');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Anybody:wdth,wght@50..150,100..900&family=Archivo:wght@700;800;900&family=Space+Mono:wght@400;700&display=swap';

const manifest = {
  pulledAt: new Date().toISOString(),
  policy: 'zero-runtime-CDN / all assets local',
  fonts: [], icons: { count: 0, source: 'web-pro/src/components/StudioIcon.vue (project-owned path data)' },
  vendor: [], notes: [],
};

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function bytes(n) { return `${(n / 1024).toFixed(1)} KB`; }

/* ---------------------------------------------------------------- 1. 字体 */
async function pullFonts() {
  ensure(path.join(DEMO, 'fonts'));
  const res = await fetch(FONT_CSS, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`字体 CSS 拉取失败: HTTP ${res.status}`);
  const css = await res.text();

  // 只取 /* latin */ 子集；中文交给系统字体栈，不下载中文字体（体积不可控）
  const blocks = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[^}]*\})/g)];
  if (!blocks.length) throw new Error('未在 Google Fonts CSS 中解析到 latin 子集');

  const faceCSS = [];
  const used = new Map();
  for (const [, block] of blocks) {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
    const weight = /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim();
    const stretch = /font-stretch:\s*([^;]+);/.exec(block)?.[1]?.trim();
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
    if (!family || !url) continue;

    const slug = `${family.toLowerCase().replace(/\s+/g, '-')}-${(weight || '400').replace(/\s+/g, '-')}`;
    const n = (used.get(slug) || 0) + 1;
    used.set(slug, n);
    const file = `${slug}${n > 1 ? '-' + n : ''}-latin.woff2`;

    const bin = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!bin.ok) throw new Error(`字体文件下载失败: ${url}`);
    const buf = Buffer.from(await bin.arrayBuffer());
    fs.writeFileSync(path.join(DEMO, 'fonts', file), buf);
    manifest.fonts.push({ file, family, weight, bytes: buf.length, upstream: url });

    faceCSS.push(`@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  ${stretch ? `font-stretch: ${stretch};` : ''}
  font-display: swap;
  src: url('./fonts/${file}') format('woff2');
  unicode-range: ${range};
}`);
  }

  fs.writeFileSync(path.join(DEMO, 'fonts.css'),
    `/* 本地字体 · 由 scripts/pull-assets.mjs 生成，禁止改回 CDN */\n${faceCSS.join('\n\n')}\n`);
  console.log(`[字体] ${manifest.fonts.length} 个 latin woff2，共 ${bytes(manifest.fonts.reduce((s, f) => s + f.bytes, 0))}`);
}

/* ---------------------------------------------------------------- 2. 图标 */
function pullIcons() {
  const src = path.join(PROJECT, 'web-pro', 'src', 'components', 'StudioIcon.vue');
  const text = fs.readFileSync(src, 'utf8');

  const slice = (startMarker, endMarker = '\n};') => {
    const a = text.indexOf(startMarker);
    if (a < 0) return '';
    const b = text.indexOf(endMarker, a);
    return text.slice(a, b);
  };
  const grab = (chunk) => {
    const out = {};
    const re = /^\s*'?([\w-]+)'?:\s*'([^']*)'\s*,?\s*(?:\/\/.*)?$/gm;
    let m;
    while ((m = re.exec(chunk))) out[m[1]] = m[2];
    return out;
  };

  const ICONS = grab(slice('const ICONS = {'));
  const MORPH_PAIRS = grab(slice('const DEFAULT_MORPH_PAIRS = {'));
  const ALIASES = grab(slice('const ALIASES = {'));
  if (Object.keys(ICONS).length < 20) throw new Error('图标表解析异常，数量过少');

  manifest.icons.count = Object.keys(ICONS).length;
  manifest.icons.morphPairs = Object.keys(MORPH_PAIRS).length;
  fs.writeFileSync(path.join(DEMO, 'icons.js'),
    `/* 本地图标路径 · 从项目 StudioIcon.vue 原样抽取，零外链 */\n` +
    `export const ICONS = ${JSON.stringify(ICONS, null, 2)};\n\n` +
    `export const MORPH_PAIRS = ${JSON.stringify(MORPH_PAIRS, null, 2)};\n\n` +
    `export const ALIASES = ${JSON.stringify(ALIASES, null, 2)};\n\n` +
    `export function iconPath(name) { return ICONS[ALIASES[name] || name] || ICONS[name] || ICONS.square; }\n`);
  console.log(`[图标] ${manifest.icons.count} 个本地 SVG path，${manifest.icons.morphPairs} 组形变对`);
}

/* ------------------------------------------------- 3. morphicons 运行时 */
function pullVendor() {
  const pkgDir = path.join(PROJECT, 'web-pro', 'node_modules', 'morphicons');
  const outDir = path.join(DEMO, 'vendor', 'morphicons');
  ensure(outDir);
  const dist = path.join(pkgDir, 'dist');
  let total = 0;
  for (const f of fs.readdirSync(dist)) {
    // 复制整个 dist：保证所有相对 import 都能解析（含仅被 svelte/astro 入口引用的文件）
    const buf = fs.readFileSync(path.join(dist, f));
    fs.writeFileSync(path.join(outDir, f), buf);
    total += buf.length;
    if (f.endsWith('.js')) manifest.vendor.push({ file: f, bytes: buf.length });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  fs.copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'LICENSE'));
  manifest.vendorLicense = `${pkg.name}@${pkg.version} · ${pkg.license}`;
  console.log(`[运行时] ${pkg.name}@${pkg.version} (${pkg.license}) ${manifest.vendor.length} 个 ESM 文件，共 ${bytes(total)}`);
}

/* ------------------------------------------------------------------ main */
(async () => {
  await pullFonts();
  pullIcons();
  pullVendor();
  manifest.notes.push('中文不下载字体子集，走系统字体栈：PingFang SC / Microsoft YaHei / Noto Sans SC');
  manifest.notes.push('demo 页面所有 <link>/<script>/@font-face 均为相对路径，可用 file:// 或任意静态服务器断网打开');
  fs.writeFileSync(path.join(DEMO, 'assets-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(DEMO, 'assets-data.js'),
    `/* 本地资源清单 · 由 scripts/pull-assets.mjs 生成 */\nexport const ASSETS = ${JSON.stringify(manifest, null, 2)};\n`);
  console.log('[完成] assets-manifest.json / assets-data.js 已写入');
})().catch((e) => { console.error('[失败]', e.message); process.exit(1); });
