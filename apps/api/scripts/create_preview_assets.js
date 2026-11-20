/**
 * 多角度快照与单品预览资产同步/占位生成
 *
 * 数据平面（按优先级探测，可达才参与）：
 *   1. 仓内 data/previews（开发默认 + git 忽略的真实渲染图）
 *   2. Windows 用户目录 ~/.dsh-material-library/previews（Windows node 通道）
 *   3. WSL 正式环境 \\wsl.localhost\<distro>\home\<user>\.dsh-material-library\previews
 *      （30001/30002 生产通道；distro 可用 ML_WSL_DISTRO 覆盖，默认 smu）
 *
 * 策略：在所有可达目录中挑选 >30KB 的最大真实渲染图，回写到所有可达目录；
 * 都没有时才生成 SVG 占位。这样新机/新数据目录（尤其 WSL 生产侧）不会对
 * product_presets 已种子化的快照角度返回 404。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

function discoverDirs() {
  const dirs = [
    { name: 'repo', dir: path.join(__dirname, '../data/previews') },
    { name: 'win-home', dir: path.join(os.homedir(), '.dsh-material-library/previews') }
  ];

  // WSL 正式目录（UNC）。不可达时静默跳过——非 Windows / 未装 WSL / distro 名不同均不报错。
  const distro = process.env.ML_WSL_DISTRO || 'smu';
  const wslUser = process.env.ML_WSL_USER || os.userInfo().username;
  for (const prefix of ['\\\\wsl.localhost\\', '\\\\wsl$\\']) {
    const unc = `${prefix}${distro}\\home\\${wslUser}\\.dsh-material-library\\previews`;
    try {
      if (fs.existsSync(unc)) {
        dirs.push({ name: `wsl(${distro})`, dir: unc });
        break;
      }
    } catch (_) { /* UNC 不可达，降级 */ }
  }

  for (const d of dirs) {
    try { fs.mkdirSync(d.dir, { recursive: true }); d.ok = true; }
    catch (e) { d.ok = false; d.error = e.message; }
  }
  return dirs.filter((d) => d.ok);
}

function pickBestBuffer(fileName, dirs) {
  let best = null;
  for (const { dir } of dirs) {
    const p = path.join(dir, fileName);
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 30000) {
        const buf = fs.readFileSync(p);
        if (!best || buf.length > best.length) best = buf;
      }
    } catch (_) { /* 单个源不可读不影响其他源 */ }
  }
  return best;
}

async function createPreviews() {
  const dirs = discoverDirs();
  console.log('Preview targets:', dirs.map((d) => `${d.name}=${d.dir}`).join(' | ') || '(none)');

  const snapshotFiles = [
    'sofa_single.png',
    'sofa_electric_single_right_45.png',
    'sofa_electric_single_front_0.png',
    'sofa_electric_single_front.png',
    'sofa_electric_single_right_90.png',
    'chair_01.png',
    'table_01.png'
  ];

  // 真实 3D 渲染快照：多平面之间互相补齐（以最大的一份为准）
  for (const fn of snapshotFiles) {
    const buf = pickBestBuffer(fn, dirs);
    if (!buf) continue;
    for (const { name, dir } of dirs) {
      const target = path.join(dir, fn);
      try {
        if (!fs.existsSync(target) || fs.statSync(target).size !== buf.length) {
          fs.writeFileSync(target, buf);
          console.log(`Synced 3D render preview -> ${name}: ${fn} (${buf.length} bytes)`);
        }
      } catch (e) {
        console.warn(`Skip ${name}/${fn}: ${e.message}`);
      }
    }
  }

  const items = [
    { name: 'sofa_single.png', label: '极简单人电动沙发' },
    { name: 'chair_01.png', label: '意式轻奢休闲单椅' },
    { name: 'table_01.png', label: '极简悬浮岩板茶几' }
  ];

  for (const it of items) {
    if (pickBestBuffer(it.name, dirs)) continue; // 已有真实高清渲染图，跳过占位
    const svg = `
      <svg width="600" height="600" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g_${it.name.replace(/[^a-z0-9]/gi, '')}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
        </defs>
        <rect width="600" height="600" rx="48" fill="url(#g_${it.name.replace(/[^a-z0-9]/gi, '')})"/>
        <circle cx="300" cy="260" r="120" fill="#334155" fill-opacity="0.3"/>
        <text x="300" y="380" font-size="28" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, sans-serif" font-weight="600" fill="#94a3b8" text-anchor="middle">${it.label}</text>
      </svg>
    `;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    for (const { name, dir } of dirs) {
      const p = path.join(dir, it.name);
      try {
        if (!fs.existsSync(p) || fs.statSync(p).size <= 30000) {
          fs.writeFileSync(p, buf);
          console.log('Written fallback:', `${name}/${it.name}`);
        }
      } catch (e) {
        console.warn(`Skip fallback ${name}/${it.name}: ${e.message}`);
      }
    }
  }
  console.log('All previews checked & synced.');
}

createPreviews().catch((e) => { console.error(e); process.exitCode = 1; });
