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

async function sendRpcRequest(action, actionParams = {}, method = 'POST') {
  const { accessKeyId, accessKeySecret } = getCredentials();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('未配置 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET，无法调用阿里云视频超分');
  }

  const commonParams = {
    Action: action,
    Version: API_VERSION,
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

  const url = `https://${ENDPOINT}/`;

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
  const status = String(jobData.Status || '').toUpperCase(); // PROCESSING, SUCCESS, FAIL
  let resultUrl = null;

  if (status === 'SUCCESS' && jobData.Result) {
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
 * @returns {Promise<{ localPath: string, remoteUrl: string, jobId: string }>}
 */
async function processVideoSuperResolution(videoUrl, options = {}) {
  const { outputDir = os.tmpdir(), bitRate = 10, maxWaitMs = 300000, pollIntervalMs = 3000 } = options;
  const jobId = await submitSuperResolveVideo(videoUrl, bitRate);

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const query = await querySuperResolveResult(jobId);
    if (query.status === 'SUCCESS' && query.resultUrl) {
      const fileName = `ali_sr_${jobId}_${Date.now()}.mp4`;
      const localPath = path.join(outputDir, fileName);
      await downloadFile(query.resultUrl, localPath);
      return {
        jobId,
        remoteUrl: query.resultUrl,
        localPath,
      };
    }
    if (query.status === 'FAIL') {
      throw new Error(`阿里云视频超分辨率任务处理失败: ${query.errorMessage || '未知算法异常'}`);
    }
  }

  throw new Error(`阿里云视频超分辨率任务超时（等待超过 ${Math.round(maxWaitMs / 1000)} 秒）`);
}

module.exports = {
  getCredentials,
  submitSuperResolveVideo,
  querySuperResolveResult,
  downloadFile,
  processVideoSuperResolution,
};
