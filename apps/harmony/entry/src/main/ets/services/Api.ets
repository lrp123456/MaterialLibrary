import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';

/** 改成电脑局域网 IP + 素材库端口，例如 http://192.168.1.12:30001 */
export let BASE_URL: string = 'http://127.0.0.1:30001';

export function setBaseUrl(url: string): void {
  BASE_URL = url.replace(/\/$/, '');
}

export class MaterialApi {
  token: string = '';

  async login(username: string, password: string): Promise<void> {
    const extra: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: JSON.stringify({ username, password })
    };
    const res = await this.request('/api/auth/login', extra);
    let body: Record<string, Object>;
    try {
      body = JSON.parse(res) as Record<string, Object>;
    } catch (e) {
      // R1：服务端返回非 JSON（如网关 HTML 错页）时给出带状态码/响应片段的业务错误
      throw new Error(`登录响应解析失败（HTTP 2xx，片段: ${res.slice(0, 200)}）`);
    }
    const data = body['data'] as Record<string, Object>;
    if (!data) {
      throw new Error(`登录响应缺少 data 字段（片段: ${res.slice(0, 200)}）`);
    }
    this.token = data['token'] as string;
    if (!this.token) {
      throw new Error('登录未返回 token');
    }
  }

  async ingestFile(absPath: string, fileName: string, clientAssetId: string, onProgress?: (pct: number) => void): Promise<Record<string, Object>> {
    const stat = fileIo.statSync(absPath);
    const buf = new ArrayBuffer(stat.size);
    const file = fileIo.openSync(absPath, fileIo.OpenMode.READ_ONLY);
    try {
      fileIo.readSync(file.fd, buf);
    } finally {
      fileIo.closeSync(file);
    }
    if (onProgress) {
      onProgress(40);
    }
    const extra: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'image/jpeg',
        'X-Filename': fileName,
        'X-Source': 'harmony',
        'X-Client-Asset-Id': clientAssetId
      },
      extraData: buf,
      connectTimeout: 30000,
      readTimeout: 180000
    };
    const res = await this.request('/api/assets/ingest', extra);
    if (onProgress) {
      onProgress(100);
    }
    let parsed: Record<string, Object>;
    try {
      parsed = JSON.parse(res) as Record<string, Object>;
    } catch (e) {
      // R1：非 JSON 响应（如反向代理错页/502 HTML）不得变成静默脏数据
      throw new Error(`入库响应解析失败（HTTP 2xx，片段: ${res.slice(0, 200)}）`);
    }
    if (parsed['success'] === false) {
      throw new Error((parsed['error'] as string) || '入库失败');
    }
    return (parsed['data'] as Record<string, Object>) ?? parsed;
  }

  private async request(path: string, extra: http.HttpRequestOptions): Promise<string> {
    const client = http.createHttp();
    try {
      const resp = await client.request(`${BASE_URL}${path}`, extra);
      const code = resp.responseCode;
      let text = '';
      if (typeof resp.result === 'string') {
        text = resp.result;
      } else {
        const helper = new util.TextDecoder('utf-8');
        text = helper.decodeWithStream(resp.result as ArrayBuffer);
      }
      if (code < 200 || code >= 300) {
        throw new Error(`HTTP ${code}: ${text.slice(0, 200)}`);
      }
      return text;
    } finally {
      client.destroy();
    }
  }
}
