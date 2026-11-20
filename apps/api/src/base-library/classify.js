/**
 * JEV 选区装修面八选一分类代理 (TypeSafe System One Choice)
 */

const { getFlag } = require('./list');

const VALID_SURFACES = [
  'ceiling',
  'wall',
  'floor',
  'millwork',
  'furniture',
  'lighting',
  'fixture',
  'soft'
];

// 每用户 10 分钟最多 20 次
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_CALLS = 20;
const userCallTimes = new Map();

function checkClassifyRateLimit(userId) {
  const uid = String(userId || 'anon');
  const now = Date.now();
  let times = userCallTimes.get(uid) || [];
  times = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (times.length >= RATE_LIMIT_MAX_CALLS) {
    userCallTimes.set(uid, times);
    return false; // 超出限额
  }
  times.push(now);
  userCallTimes.set(uid, times);
  return true;
}

function resetClassifyRateLimits() {
  userCallTimes.clear();
}

/**
 * 解析 TypeSafe JEV 响应体
 * 门槛只看 answers.surface.probabilities[choice] >= 0.75
 * confidence 只记日志，绝不拿去与 0.75 比较
 */
function parseJevResponse(resJson) {
  const model = resJson && resJson.model ? String(resJson.model) : 'jev-unknown';
  const surfaceAnswer = resJson && resJson.answers && resJson.answers.surface;
  const choice = surfaceAnswer && surfaceAnswer.choice;
  const probabilities = (surfaceAnswer && surfaceAnswer.probabilities) || null;
  const confidence = surfaceAnswer && typeof surfaceAnswer.confidence === 'number' ? surfaceAnswer.confidence : null;

  if (!choice || !VALID_SURFACES.includes(choice) || !probabilities || typeof probabilities[choice] !== 'number') {
    return {
      surface: null,
      probability: 0,
      uncertain: true,
      model,
      confidence,
      probabilities: probabilities || {}
    };
  }

  const prob = probabilities[choice];
  if (prob < 0.75) {
    return {
      surface: null,
      probability: prob,
      uncertain: true,
      model,
      confidence,
      probabilities
    };
  }

  return {
    surface: choice,
    probability: prob,
    uncertain: false,
    model,
    confidence,
    probabilities
  };
}

let warnedMissingApiKey = false;
let envLoaded = false;

function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  if (!process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.resolve(__dirname, '../../.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/(?:TYPESAFE_API_KEY|JEV_API_KEY)\s*=\s*([^\r\n#]+)/);
        if (match && match[1]) {
          process.env.TYPESAFE_API_KEY = match[1].trim();
        }
      }
    } catch (_) {}
  }
}
loadEnvOnce();

function resolveApiKey() {
  return process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
}

/**
 * 调用 TypeSafe JEV 对选区切片进行八选一分类
 * @param {object} db SQLite db
 * @param {Buffer} cropJpegBuffer 选区纯净 JPEG Buffer (280~1568)
 * @param {object} options 可选配置（支持自定义 fetch 用于测试注入）
 */
async function classifyRegionSurface(db, cropJpegBuffer, options = {}) {
  const flagEnabled = getFlag(db, 'base_library_jev');
  if (!flagEnabled) {
    return {
      success: true,
      data: {
        surface: null,
        probability: 0,
        uncertain: true,
        model: 'disabled',
        probabilities: {}
      }
    };
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      console.warn('[base-library] TYPESAFE_API_KEY is not configured');
      warnedMissingApiKey = true;
    }
    return {
      success: true,
      data: {
        surface: null,
        probability: 0,
        uncertain: true,
        model: 'no_key',
        probabilities: {}
      }
    };
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const payload = {
    model: 'jev-latest',
    state: { crop: 'crop1' },
    assets: {
      crop1: {
        type: 'image',
        format: 'jpg',
        data_base64: cropJpegBuffer.toString('base64')
      }
    },
    questions: {
      surface: {
        type: 'choice',
        instructions: 'Judge the majority architectural surface in `crop`, not a small object sitting on it.',
        criteria: {
          ceiling: '天花、吊顶、梁底',
          wall: '墙面，而不是靠墙的小家具',
          floor: '地面',
          millwork: '全屋定制：柜门、线条、台面',
          furniture: '活动家具：桌、椅、床架',
          lighting: '灯具本身',
          fixture: '卫浴、厨电、五金',
          soft: '软装：窗帘、床品、挂画、摆件、绿植'
        }
      }
    }
  };

  try {
    const res = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'TypeSafe-Danger-Zone-Images': 'true',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const ms = Date.now() - startTime;
    if (!res.ok) {
      console.log(`[base-library] classify status=${res.status} ms=${ms} model=upstream_error surface=null probability=0 uncertain=true`);
      return {
        success: true,
        data: {
          surface: null,
          probability: 0,
          uncertain: true,
          model: `http_${res.status}`,
          probabilities: {}
        }
      };
    }

    const json = await res.json();
    const parsed = parseJevResponse(json);
    const confLog = parsed.confidence !== null ? ` confidence=${parsed.confidence}` : '';
    console.log(`[base-library] classify status=${res.status} ms=${ms} model=${parsed.model} surface=${parsed.surface} probability=${parsed.probability} uncertain=${parsed.uncertain}${confLog}`);

    return {
      success: true,
      data: {
        surface: parsed.surface,
        probability: parsed.probability,
        uncertain: parsed.uncertain,
        model: parsed.model,
        probabilities: parsed.probabilities
      }
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const ms = Date.now() - startTime;
    const isAbort = err.name === 'AbortError';
    const errCode = isAbort ? 'timeout' : 'network_error';
    console.log(`[base-library] classify status=0 ms=${ms} model=${errCode} surface=null probability=0 uncertain=true`);
    return {
      success: true,
      data: {
        surface: null,
        probability: 0,
        uncertain: true,
        model: errCode,
        probabilities: {}
      }
    };
  }
}

module.exports = {
  VALID_SURFACES,
  checkClassifyRateLimit,
  resetClassifyRateLimits,
  parseJevResponse,
  classifyRegionSurface
};
