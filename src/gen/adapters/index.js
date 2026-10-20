/**
 * 新生成协议安全热加载器与目录管理器 (Custom Adapters Hot-Loader)
 * 严格限定只能在 src/gen/adapters/ 目录下读写合法的 .js 协议文件。
 * 具备前置字节快照、出口形状校验与原子回滚机制。
 */
const fs = require('fs');
const path = require('path');
const { isBuiltinProtocol } = require('../builtin-protocols');

const ADAPTERS_DIR = path.resolve(__dirname);
const loadedAdapters = new Map(); // protocol -> module instance

function validateExportShape(mod, filename = '') {
  if (!mod || typeof mod !== 'object') {
    throw new Error(`适配器 ${filename} 导出必须为一个非空对象`);
  }
  if (!mod.protocol || typeof mod.protocol !== 'string' || !mod.protocol.trim()) {
    throw new Error(`适配器 ${filename} 必须导出非空的 protocol 字符串`);
  }
  if (!mod.method || typeof mod.method !== 'string' || !mod.method.trim()) {
    throw new Error(`适配器 ${filename} 必须导出非空的 method 字符串`);
  }
  if (!mod.urlTemplate || typeof mod.urlTemplate !== 'string' || !mod.urlTemplate.trim()) {
    throw new Error(`适配器 ${filename} 必须导出非空的 urlTemplate 字符串`);
  }
  if (!mod.paramLocations || typeof mod.paramLocations !== 'object') {
    throw new Error(`适配器 ${filename} 必须导出 paramLocations 参数位置对象`);
  }
  if (typeof mod.buildRequest !== 'function') {
    throw new Error(`适配器 ${filename} 必须导出 buildRequest(ctx) 函数`);
  }
  if (typeof mod.parseResponse !== 'function') {
    throw new Error(`适配器 ${filename} 必须导出 parseResponse(data, ctx) 函数`);
  }
  return true;
}

function resolveSafePath(filename) {
  const raw = String(filename || '').trim();
  if (!raw) {
    throw new Error('文件名非法：文件名不能为空');
  }
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    throw new Error('文件名非法：禁止向适配器目录以外的路径写入文件');
  }
  let baseName = raw;
  if (!baseName.endsWith('.js')) {
    baseName = `${baseName}.js`;
  }
  if (!/^[a-zA-Z0-9_-]+\.js$/.test(baseName)) {
    throw new Error('文件名非法：仅允许使用字母、数字、下划线及中划线，并以 .js 结尾');
  }
  if (baseName === 'index.js') {
    throw new Error('禁止覆盖适配器入口文件 index.js');
  }
  const resolved = path.resolve(ADAPTERS_DIR, baseName);
  if (!resolved.startsWith(ADAPTERS_DIR + path.sep)) {
    throw new Error('禁止向适配器目录以外的路径写入文件');
  }
  return { baseName, resolved };
}

/**
 * 安全写入并热加载适配器文件（具备原子快照与回滚机制）
 *
 * SEC-005：动态落盘 + require() 等于在主进程执行任意代码，且可被
 * /api/governance/skill-drafts 链路（含 LLM 生成内容）触达，叠加局域网
 * 提权即成零凭据 RCE。默认禁用；确有需要时以 ALLOW_DYNAMIC_CODE_ADAPTERS=1
 * 显式开启（仅限本机开发环境）。声明式 data 类草稿（JSON 模型契约）不走本函数，不受影响。
 */
function safeInstallAdapter(filename, codeContent) {
  if (String(process.env.ALLOW_DYNAMIC_CODE_ADAPTERS || '') !== '1') {
    throw new Error('动态代码适配器安装已默认禁用（SEC-005）。确需启用请设置环境变量 ALLOW_DYNAMIC_CODE_ADAPTERS=1 并重启服务；data 类声明式草稿不受影响。');
  }
  const { baseName, resolved } = resolveSafePath(filename);

  const existed = fs.existsSync(resolved);
  const backupBuf = existed ? fs.readFileSync(resolved) : null;
  const previousMemoryMod = Array.from(loadedAdapters.values()).find((m) => m.filename === baseName);

  let installedMod = null;
  try {
    fs.writeFileSync(resolved, codeContent, 'utf8');

    // 清除 require 缓存并动态加载
    try {
      delete require.cache[require.resolve(resolved)];
    } catch (_) {}

    installedMod = require(resolved);
    validateExportShape(installedMod, baseName);

    // 规则 1：已内置的协议名禁止被同名新文件覆盖
    if (isBuiltinProtocol(installedMod.protocol)) {
      throw new Error(`协议名 "${installedMod.protocol}" 为系统内置协议，严禁被新文件覆盖`);
    }

    // 规则 2：同一新协议名只留第一份，若已存在且不是本文件更新，则拒绝加载
    const existingForProto = loadedAdapters.get(installedMod.protocol);
    if (existingForProto && existingForProto.filename && existingForProto.filename !== baseName) {
      throw new Error(`新协议名 "${installedMod.protocol}" 已被文件 ${existingForProto.filename} 登记，拒绝覆盖`);
    }

    // 注册到内存表
    const registeredEntry = {
      ...installedMod,
      filename: baseName,
      filePath: resolved,
    };
    loadedAdapters.set(installedMod.protocol, registeredEntry);

    return {
      success: true,
      protocol: installedMod.protocol,
      filename: baseName,
      module: registeredEntry,
    };
  } catch (err) {
    // 触发安全原子回滚
    try {
      if (existed && backupBuf) {
        fs.writeFileSync(resolved, backupBuf);
        try {
          delete require.cache[require.resolve(resolved)];
          const rolledBackMod = require(resolved);
          loadedAdapters.set(rolledBackMod.protocol, { ...rolledBackMod, filename: baseName, filePath: resolved });
        } catch (_) {
          // 若旧文件重新编译失败，保留确认前内存中的模块指针
          if (previousMemoryMod) {
            loadedAdapters.set(previousMemoryMod.protocol, previousMemoryMod);
          }
        }
      } else if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
        try {
          delete require.cache[require.resolve(resolved)];
        } catch (_) {}
      }
    } catch (_) {}

    throw new Error(`适配器热加载失败，已自动退回上一份: ${err.message}`);
  }
}

/**
 * 启动时逐个尝试加载 adapters 目录下的 *.js 文件
 * 单个坏文件不能拖垮主服务启动
 */
function scanAndLoadAdapters() {
  if (!fs.existsSync(ADAPTERS_DIR)) {
    try {
      fs.mkdirSync(ADAPTERS_DIR, { recursive: true });
    } catch (_) {}
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(ADAPTERS_DIR);
  } catch (e) {
    console.warn('[adapters-loader] 扫描目录失败:', e.message);
    return;
  }

  for (const f of entries) {
    if (!f.endsWith('.js') || f === 'index.js') continue;
    if (!/^[a-zA-Z0-9_-]+\.js$/.test(f)) continue;
    const fullPath = path.resolve(ADAPTERS_DIR, f);

    try {
      delete require.cache[fullPath];
      const mod = require(fullPath);
      validateExportShape(mod, f);

      if (isBuiltinProtocol(mod.protocol)) {
        console.warn(`[adapters-loader] 跳过文件 ${f}: 协议 "${mod.protocol}" 属于内置协议`);
        continue;
      }
      if (loadedAdapters.has(mod.protocol)) {
        console.warn(`[adapters-loader] 跳过文件 ${f}: 协议 "${mod.protocol}" 已由先前文件加载`);
        continue;
      }

      loadedAdapters.set(mod.protocol, {
        ...mod,
        filename: f,
        filePath: fullPath,
      });
      console.log(`[adapters-loader] 成功挂载自定义生成适配器: ${mod.protocol} (${f})`);
    } catch (e) {
      console.warn(`[adapters-loader] 加载适配器 ${f} 失败（已跳过，不影响服务启动）:`, e.message);
    }
  }
}

function getAdapterModule(protocol) {
  if (!protocol || isBuiltinProtocol(protocol)) return null;
  return loadedAdapters.get(protocol) || null;
}

function listLoadedCustomAdapters() {
  const list = [];
  for (const [protocol, mod] of loadedAdapters.entries()) {
    list.push({
      protocol,
      name: mod.name || protocol,
      method: mod.method || 'POST',
      urlTemplate: mod.urlTemplate || '',
      paramLocations: mod.paramLocations || {},
      filename: mod.filename || '',
    });
  }
  return list;
}

// 首次执行扫描
scanAndLoadAdapters();

module.exports = {
  ADAPTERS_DIR,
  safeInstallAdapter,
  getAdapterModule,
  listLoadedCustomAdapters,
  validateExportShape,
  scanAndLoadAdapters,
};
