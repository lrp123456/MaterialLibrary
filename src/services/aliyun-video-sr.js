/**
 * 阿里云视觉智能开放平台 (VIAPI) - 视频超分辨率 (SuperResolveVideo)
 * 采用原生 Node.js crypto 实现阿里云 POP RPC 1.0 签名，无第三方重型依赖。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const ENDPOINT = 'videoenhan.cn-shanghai.aliyuncs.com';
const API_VERSION = '2020-03-20';
const UTILS_ENDPOINT = 'viapiutils.cn-shanghai.aliyuncs.com';
const UTILS_VERSION = '2020-04-01';
const VIAPI_BUCKET = 'viapi-customer-temp';
const VIAPI_OSS_HOST = `${VIAPI_BUCKET}.oss-cn-shanghai.aliyuncs.com`;

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function getCredentials() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET || '';
  const region = process.env.ALIYUN_REGION || 'cn-shanghai';
  return { accessKeyId, accessKeySecret, region };
}

function signParams(params, secret, method = 'POST') {
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQuery = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(String(params[key]))}`)
    .join('&');

  const stringToSign = `${method.toUpperCase()}&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`;
  const key = `${secret}&`;
  const signature = crypto.createHmac('sha1', key).update(stringToSign).digest('base64');
  return { ...params, Signature: signature };
}

function isShanghaiOssUrl(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return host === VIAPI_OSS_HOST || host.endsWith('.oss-cn-shanghai.aliyuncs.com');
  } catch {
    return false;
  }
}

async function sendRpcRequest(action, actionParams = {}, options = {}) {
  const method = options.method || 'POST';
  const endpoint = options.endpoint || ENDPOINT;
  const version = options.version || API_VERSION;
  const { accessKeyId, accessKeySecret } = getCredentials();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('未配置 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET，无法调用阿里云视频超分');
  }

  const commonParams = {
    Action: action,
    Version: version,
    Format: 'JSON',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  const allParams = { ...commonParams, ...actionParams };
  const signed = signParams(allParams, accessKeySecret, method);

  const postBody = Object.keys(signed)
    .map(k => `${percentEncode(k)}=${percentEncode(String(signed[k]))}`)
    .join('&');

  const url = `https://${endpoint}/`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postBody,
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`阿里云 VIAPI 响应非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || json.Code) {
    const code = json.Code || res.status;
    const msg = json.Message || text;
    throw new Error(`阿里云 VIAPI 错误 [${code}]: ${msg}`);
  }

  return json;
}

/**
 * 本地文件或非上海 OSS 地址先上传到视觉智能的临时上海 Bucket。
 * 路径前缀必须是调用 GetOssStsToken 时使用的 AccessKeyId。
 * 得到的地址只给 SuperResolveVideo 用，浏览器打不开。
 */
async function uploadLocalForViapi(localPath) {
  const { accessKeyId } = getCredentials();
  if (!accessKeyId) {
    throw new Error('未配置 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET，无法调用阿里云视频超分');
  }
  if (!localPath || !fs.existsSync(localPath)) throw new Error('超分源文件不在本地');
  const tokenJson = await sendRpcRequest('GetOssStsToken', {}, {
    endpoint: UTILS_ENDPOINT,
    version: UTILS_VERSION,
  });
  const data = tokenJson.Data || tokenJson;
  const stsId = String(data.AccessKeyId || '');
  const stsSecret = String(data.AccessKeySecret || '');
  const stsToken = String(data.SecurityToken || '');
  if (!stsId || !stsSecret || !stsToken) throw new Error('超分临时上传凭证不完整');

  const baseName = path.basename(localPath).replace(/[^\w.-]/g, '') || 'clip.mp4';
  const objectKey = `${accessKeyId}/${crypto.randomUUID()}/${baseName}`;
  const contentType = 'video/mp4';
  const date = new Date().toUTCString();
  const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-security-token:${stsToken}\n/${VIAPI_BUCKET}/${objectKey}`;
  const signature = crypto.createHmac('sha1', stsSecret).update(stringToSign).digest('base64');
  const res = await fetch(`https://${VIAPI_OSS_HOST}/${objectKey}`, {
    method: 'PUT',
    headers: {
      Date: date,
      'Content-Type': contentType,
      'x-oss-security-token': stsToken,
      Authorization: `OSS ${stsId}:${signature}`,
    },
    body: fs.readFileSync(localPath),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`超分临时文件上传失败（HTTP ${res.status}）`);
  return `http://${VIAPI_OSS_HOST}/${objectKey}`;
}

/**
 * 提交视频超分辨率异步任务
 * @param {string} videoUrl 输入视频公网 URL
 * @param {number} bitRate 码率 (Mbps, 默认 10)
 * @returns {Promise<string>} jobId / RequestId
 */
async function submitSuperResolveVideo(videoUrl, bitRate = 10) {
  if (!videoUrl) throw new Error('videoUrl 不能为空');
  const safeBitRate = Math.max(1, Math.min(20, Math.round(Number(bitRate) || 10)));
  const data = await sendRpcRequest('SuperResolveVideo', {
    VideoUrl: videoUrl,
    BitRate: safeBitRate,
  });
  const jobId = data.RequestId;
  if (!jobId) {
    throw new Error(`提交视频超分未返回 RequestId: ${JSON.stringify(data)}`);
  }
  return jobId;
}

/**
 * 查询视频超分异步任务结果
 * @param {string} jobId
 * @returns {Promise<{ status: string, resultUrl: string|null, raw: object }>}
 */
async function querySuperResolveResult(jobId) {
  if (!jobId) throw new Error('jobId 不能为空');
  const data = await sendRpcRequest('GetAsyncJobResult', {
    JobId: jobId,
  });

  const jobData = data.Data || {};
  const status = String(jobData.Status || '').toUpperCase();
  let resultUrl = null;

  if (classifyJobStatus(status) === 'success' && jobData.Result) {
    try {
      const parsed = typeof jobData.Result === 'string' ? JSON.parse(jobData.Result) : jobData.Result;
      resultUrl = parsed.VideoUrl || null;
    } catch (_) {}
  }

  return {
    jobId,
    status,
    resultUrl,
    errorMessage: jobData.ErrorMessage || jobData.Message || null,
    raw: data,
  };
}

/**
 * 下载远程 URL 到指定本地路径
 */
/** 视觉智能异步任务的成功态是 PROCESS_SUCCESS，失败态是 PROCESS_FAILED。 */
function classifyJobStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'SUCCESS' || value === 'PROCESS_SUCCESS') return 'success';
  if (value === 'FAIL' || value === 'FAILED' || value === 'PROCESS_FAILED' || value === 'TIMEOUT_FAILED' || value === 'LIMIT_RETRY_FAILED') {
    return 'fail';
  }
  return 'pending';
}

function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = fileUrl.startsWith('https') ? https : http;
    client.get(fileUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // 重定向跟随
        file.close();
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`下载视频失败，HTTP 状态码: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * 一体化超分辨率流程：提交任务 -> 轮询结果 -> 下载落盘
 * @param {string} videoUrl 输入视频公网 URL
 * @param {object} options
 * @param {string} [options.outputDir] 本地保存目录
 * @param {number} [options.bitRate=10]
 * @param {number} [options.maxWaitMs=300000] 最大等待时间 (默认 5 分钟)
 * @param {number} [options.pollIntervalMs=3000] 轮询间隔
 * @param {Function} [options.onStage] 阶段进度回调 ({ key, label, progress, detail? })
 * @returns {Promise<{ localPath: string, remoteUrl: string, jobId: string, timing: object }>}
 */
async function processVideoSuperResolution(videoUrl, options = {}) {
  const {
    outputDir = os.tmpdir(),
    bitRate = 10,
    maxWaitMs = 300000,
    pollIntervalMs = 3000,
    localPath = '',
    onStage = null,
  } = options;
  const emit = (stage) => {
    if (typeof onStage !== 'function') return;
    try { onStage(stage); } catch (e) { console.warn('[video-sr] 阶段回调失败:', e.message); }
  };
  const t0 = Date.now();
  let inputUrl = String(videoUrl || '');
  let uploadMs = 0;
  if (localPath) {
    emit({ key: 'sr_upload', label: '上传超分源片到上海临时 OSS', progress: 90 });
    const tUpload = Date.now();
    inputUrl = await uploadLocalForViapi(localPath);
    uploadMs = Date.now() - tUpload;
  } else if (!isShanghaiOssUrl(inputUrl)) throw new Error('超分源文件不在本地');

  const tSubmit = Date.now();
  const jobId = await submitSuperResolveVideo(inputUrl, bitRate);
  const submitMs = Date.now() - tSubmit;
  emit({ key: 'sr_processing', label: '阿里云视频超分处理中', progress: 93 });

  const startTime = Date.now();
  let polls = 0;
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    polls++;
    const query = await querySuperResolveResult(jobId);
    if (classifyJobStatus(query.status) === 'success' && query.resultUrl) {
      const processingMs = Date.now() - startTime;
      const fileName = `ali_sr_${jobId}_${Date.now()}.mp4`;
      const outPath = path.join(outputDir, fileName);
      emit({ key: 'sr_download', label: '下载超分成片', progress: 97 });
      const tDownload = Date.now();
      await downloadFile(query.resultUrl, outPath);
      const downloadMs = Date.now() - tDownload;
      return {
        jobId,
        remoteUrl: query.resultUrl,
        localPath: outPath,
        timing: {
          uploadMs,
          submitMs,
          processingMs,
          downloadMs,
          totalMs: Date.now() - t0,
          pollCount: polls,
        },
      };
    }
    if (classifyJobStatus(query.status) === 'fail') {
      throw new Error(`阿里云视频超分辨率任务处理失败: ${query.errorMessage || '未知算法异常'}`);
    }
  }

  throw new Error(`阿里云视频超分辨率任务超时（等待超过 ${Math.round(maxWaitMs / 1000)} 秒）`);
}

module.exports = {
  getCredentials,
  isShanghaiOssUrl,
  uploadLocalForViapi,
  classifyJobStatus,
  submitSuperResolveVideo,
  querySuperResolveResult,
  downloadFile,
  processVideoSuperResolution,
};
