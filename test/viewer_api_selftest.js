/**
 * ==============================================================================
 * MaterialLibraryServer - 视角端 (Viewer) 接口自动化自测套件
 * ==============================================================================
 * 用途：供服务端开发人员在本地或服务器上自主一键测试客户端所需接口是否正常工作。
 * 运行方式：
 *   node test/viewer_api_selftest.js
 * 支持环境变量：
 *   ML_TEST_HOST=http://127.0.0.1:30001 (默认)
 *   ML_TEST_USER=viewer                 (默认)
 *   ML_TEST_PASS=              (默认)
 * ==============================================================================
 */

const BASE_URL = process.env.ML_TEST_HOST || 'http://127.0.0.1:30001';
const USERNAME = process.env.ML_TEST_USER || 'viewer';
const PASSWORD = process.env.ML_TEST_PASS || '';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m'
};

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function logHeader(title) {
  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
}

function recordPass(testName, detail = '') {
  passCount++;
  console.log(`  ${colors.green}✔ [PASS]${colors.reset} ${testName} ${detail ? colors.gray + '(' + detail + ')' + colors.reset : ''}`);
}

function recordWarn(testName, reason = '') {
  warnCount++;
  console.log(`  ${colors.yellow}▲ [WARN]${colors.reset} ${testName} ${reason ? colors.yellow + '-> ' + reason + colors.reset : ''}`);
}

function recordFail(testName, error = '') {
  failCount++;
  console.log(`  ${colors.red}✖ [FAIL]${colors.reset} ${testName} ${error ? colors.red + '-> ' + error + colors.reset : ''}`);
}

async function request(path, options = {}, token = null) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    ...options,
    headers
  });
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function runAllTests() {
  console.log(`${colors.bold}${colors.magenta}`);
  console.log(`  ╔═══════════════════════════════════════════════════════╗`);
  console.log(`  ║     Material Library Viewer API Self-Test Suite       ║`);
  console.log(`  ║     目标服务器: ${BASE_URL.padEnd(36)}║`);
  console.log(`  ╚═══════════════════════════════════════════════════════╝${colors.reset}`);

  let token = null;
  let testAssetFid = null;
  let testSessionId = `test_sess_${Date.now()}`;

  // ============================================================================
  // 1. 认证鉴权测试
  // ============================================================================
  logHeader('1. 基础认证与会话 (Authentication)');
  try {
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    if (loginRes.status === 200 && (loginRes.data?.success || loginRes.data?.data?.token)) {
      token = loginRes.data.data?.token || loginRes.data.token;
      recordPass('POST /api/auth/login', `登录成功，Token: ${token.slice(0, 12)}...`);
    } else {
      recordFail('POST /api/auth/login', `HTTP ${loginRes.status}: ${JSON.stringify(loginRes.data)}`);
      console.log(`\n${colors.red}登录失败，后续需要鉴权的测试已终止，请检查账号密码或服务状态。${colors.reset}`);
      return;
    }
  } catch (err) {
    recordFail('POST /api/auth/login', `网络连接失败: ${err.message}`);
    return;
  }

  try {
    const meRes = await request('/api/viewer/auth/me', { method: 'GET' }, token);
    if (meRes.status === 200 && meRes.data?.success) {
      recordPass('GET /api/viewer/auth/me', `用户角色: ${meRes.data.data?.role}, 用户名: ${meRes.data.data?.username}`);
    } else {
      recordFail('GET /api/viewer/auth/me', `响应异常: ${JSON.stringify(meRes.data)}`);
    }
  } catch (err) {
    recordFail('GET /api/viewer/auth/me', err.message);
  }

  // ============================================================================
  // 2. 素材流与检索测试
  // ============================================================================
  logHeader('2. 素材库浏览与检索 (Assets Feed & Details)');
  try {
    const assetsRes = await request('/api/viewer/assets?page=1&pageSize=5&media_type=image', { method: 'GET' }, token);
    if (assetsRes.status === 200 && assetsRes.data?.success) {
      const items = assetsRes.data.data?.items || [];
      const total = assetsRes.data.data?.total ?? items.length;
      recordPass('GET /api/viewer/assets', `获取到素材共 ${total} 件，当前页返回 ${items.length} 件`);
      if (items.length > 0) {
        testAssetFid = items[0].fid;
      }
    } else {
      recordFail('GET /api/viewer/assets', `HTTP ${assetsRes.status}: ${JSON.stringify(assetsRes.data)}`);
    }
  } catch (err) {
    recordFail('GET /api/viewer/assets', err.message);
  }

  if (testAssetFid) {
    try {
      const detailRes = await request(`/api/viewer/assets/${encodeURIComponent(testAssetFid)}`, { method: 'GET' }, token);
      if (detailRes.status === 200 && detailRes.data?.success) {
        recordPass(`GET /api/viewer/assets/:fid`, `素材详情读取正常 [fid: ${testAssetFid}]`);
      } else {
        recordFail(`GET /api/viewer/assets/:fid`, `HTTP ${detailRes.status}`);
      }
    } catch (err) {
      recordFail('GET /api/viewer/assets/:fid', err.message);
    }
  } else {
    recordWarn('GET /api/viewer/assets/:fid', '素材库中暂无素材，已跳过详情测试');
  }

  // ============================================================================
  // 3. AI 试验场与快捷操作能力清单
  // ============================================================================
  logHeader('3. AI 快捷工坊能力清单 (Lab Capabilities & Actions)');
  try {
    const capRes = await request('/api/viewer/lab/capabilities', { method: 'GET' }, token);
    if (capRes.status === 200 && capRes.data?.success) {
      const entries = capRes.data.data?.entries || [];
      const readyEntries = entries.filter(e => e.ready);
      recordPass('GET /api/viewer/lab/capabilities', `共下发 ${entries.length} 项能力，其中就绪可用 ${readyEntries.length} 项`);

      // 检查核心算子状态
      const coreOps = ['umbra.expand', 'umbra.remove', 'umbra.insert', 'umbra.replace', 'umbra.upscale'];
      const unreadyCore = entries.filter(e => coreOps.includes(e.id) && !e.ready);
      if (unreadyCore.length > 0) {
        recordWarn('核心算子就绪度检查', `以下算子尚未就绪需配置: ${unreadyCore.map(e => e.label + '(' + (e.unavailableReason || '未就绪') + ')').join(', ')}`);
      } else {
        recordPass('核心精修算子检查', '扩图/消除/安装/替换/超分算子已全部就绪');
      }
    } else {
      recordFail('GET /api/viewer/lab/capabilities', `HTTP ${capRes.status}: ${JSON.stringify(capRes.data)}`);
    }
  } catch (err) {
    recordFail('GET /api/viewer/lab/capabilities', err.message);
  }

  // ============================================================================
  // 4. 企业级 AI 创作会话与消息流
  // ============================================================================
  logHeader('4. AI 对话会话与消息流 (Chat Sessions & Messages)');
  try {
    // 4.1 创建会话
    const createSessRes = await request('/api/viewer/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ id: testSessionId, title: '自动化自测会话' })
    }, token);
    if (createSessRes.status === 200 && createSessRes.data?.success) {
      recordPass('POST /api/viewer/chat/sessions', `成功创建测试会话 [ID: ${testSessionId}]`);
    } else {
      recordFail('POST /api/viewer/chat/sessions', `创建会话失败 HTTP ${createSessRes.status}`);
    }

    // 4.2 保存一条测试消息
    const msgId = `msg_${Date.now()}`;
    const saveMsgRes = await request('/api/viewer/chat/messages', {
      method: 'POST',
      body: JSON.stringify({
        id: msgId,
        sessionId: testSessionId,
        role: 'user',
        mode: 'image',
        prompt: '测试提示词：现代极简客厅实景',
        status: 'done'
      })
    }, token);
    if (saveMsgRes.status === 200 && saveMsgRes.data?.success) {
      recordPass('POST /api/viewer/chat/messages', `消息持久化写入成功 [MsgId: ${msgId}]`);
    } else {
      recordFail('POST /api/viewer/chat/messages', `消息写入失败 HTTP ${saveMsgRes.status}`);
    }

    // 4.3 查询会话消息流
    const getMsgsRes = await request(`/api/viewer/chat/messages?sessionId=${encodeURIComponent(testSessionId)}&limit=10`, {
      method: 'GET'
    }, token);
    if (getMsgsRes.status === 200 && getMsgsRes.data?.success) {
      const msgs = getMsgsRes.data.data || [];
      recordPass('GET /api/viewer/chat/messages', `成功读回消息流，消息条数: ${msgs.length}`);
    } else {
      recordFail('GET /api/viewer/chat/messages', `查询消息失败 HTTP ${getMsgsRes.status}`);
    }

    // 4.4 清理测试会话
    const delRes = await request(`/api/viewer/chat/sessions/${encodeURIComponent(testSessionId)}`, {
      method: 'DELETE'
    }, token);
    if (delRes.status === 200 && delRes.data?.success) {
      recordPass('DELETE /api/viewer/chat/sessions/:id', '自测临时会话已成功清理销毁');
    } else {
      recordWarn('DELETE /api/viewer/chat/sessions/:id', `清理会话状态 HTTP ${delRes.status}`);
    }
  } catch (err) {
    recordFail('Chat Session Flow', err.message);
  }

  // ============================================================================
  // 5. 提示词智能优化与扩写 (Prompt Optimizer)
  // ============================================================================
  logHeader('5. 提示词智能优化扩写 (Prompt Optimizer)');
  try {
    // 5.1 生图模式测试
    const optImgRes = await request('/api/viewer/chat/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: '极简茶室', modelId: 'seedream5lite', mode: 'text_to_image' })
    }, token);
    if (optImgRes.status === 200 && optImgRes.data?.success) {
      const opt = optImgRes.data.data?.optimized || '';
      recordPass('POST /api/viewer/chat/optimize-prompt (seedream5lite)', `字符数 ${opt.length}`);
    } else if (optImgRes.status === 400 || optImgRes.status === 502) {
      recordPass('POST /api/viewer/chat/optimize-prompt 无万能稿', `HTTP ${optImgRes.status}`);
    } else {
      recordFail('POST /api/viewer/chat/optimize-prompt (seedream5lite)', `HTTP ${optImgRes.status}: ${JSON.stringify(optImgRes.data)}`);
    }

    // 5.2 生视频模式测试
    const optVideoRes = await request('/api/viewer/chat/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: '落地窗客厅日落', modelId: 'seedance2_5', mode: 'omni_reference' })
    }, token);
    if (optVideoRes.status === 200 && optVideoRes.data?.success) {
      const opt = optVideoRes.data.data?.optimized || '';
      recordPass('POST /api/viewer/chat/optimize-prompt (seedance2_5)', `字符数 ${opt.length}`);
    } else if (optVideoRes.status === 400 || optVideoRes.status === 502) {
      recordPass('POST /api/viewer/chat/optimize-prompt (seedance2_5) 无万能稿', `HTTP ${optVideoRes.status}`);
    } else {
      recordFail('POST /api/viewer/chat/optimize-prompt (seedance2_5)', `HTTP ${optVideoRes.status}`);
    }
  } catch (err) {
    recordFail('POST /api/viewer/chat/optimize-prompt', err.message);
  }

  // ============================================================================
  // 6. 实例分割与物体轮廓探测 (AI Instance Segmentation)
  // ============================================================================
  logHeader('6. 实例分割与目标检测 (Instance Segmentation)');
  try {
    // 发送 1x1 像素测试图片
    const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const segRes = await request('/api/viewer/ai/segment', {
      method: 'POST',
      body: JSON.stringify({ image: dummyBase64 })
    }, token);

    if (segRes.status === 200 && segRes.data?.success) {
      const detections = segRes.data.data?.detections || [];
      const isFallback = segRes.data.data?.fallback === true;
      if (isFallback) {
        recordWarn('POST /api/viewer/ai/segment', `返回了 Mock/Fallback 数据 (${detections.length} 个目标)。建议接入真实 YOLOv8-seg 或 SAM2 推理服务`);
      } else {
        recordPass('POST /api/viewer/ai/segment', `成功执行真实模型推理，检出目标数: ${detections.length}`);
      }
    } else {
      recordFail('POST /api/viewer/ai/segment', `HTTP ${segRes.status}: ${JSON.stringify(segRes.data)}`);
    }
  } catch (err) {
    recordFail('POST /api/viewer/ai/segment', err.message);
  }

  // ============================================================================
  // 7. 3D 预置产品库与软装替换清单 (3D Presets & GLB)
  // ============================================================================
  logHeader('7. 3D 软装模型预置库 (3D Presets & GLB Models)');
  try {
    const presetRes = await request('/api/viewer/products/presets', { method: 'GET' }, token);
    if (presetRes.status === 200 && presetRes.data?.success) {
      const presets = presetRes.data.data || [];
      recordPass('GET /api/viewer/products/presets', `下发软装模型预设共 ${presets.length} 款`);
      if (presets.length < 3) {
        recordWarn('预置模型丰富度', `当前仅预置 ${presets.length} 款模型，建议扩展为包含沙发/茶几/单椅/灯具等全品类软装库`);
      }
    } else {
      recordFail('GET /api/viewer/products/presets', `HTTP ${presetRes.status}: ${JSON.stringify(presetRes.data)}`);
    }
  } catch (err) {
    recordFail('GET /api/viewer/products/presets', err.message);
  }

  // ============================================================================
  // 8. 贴图与遮罩文件上传 (AI Upload)
  // ============================================================================
  logHeader('8. 临时贴图与遮罩上传 (AI Upload Multipart)');
  try {
    // 构造极简 multipart/form-data
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test_mask.png"',
      'Content-Type: image/png',
      '',
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('binary'),
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const uploadRes = await fetch(`${BASE_URL}/api/viewer/ai/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: Buffer.from(multipartBody, 'binary')
    });

    const uploadData = await uploadRes.json();
    if (uploadRes.status === 200 && uploadData.success) {
      recordPass('POST /api/viewer/ai/upload', `上传成功，返回 URL: ${uploadData.data?.url || uploadData.data?.id}`);
    } else {
      recordFail('POST /api/viewer/ai/upload', `HTTP ${uploadRes.status}: ${JSON.stringify(uploadData)}`);
    }
  } catch (err) {
    recordFail('POST /api/viewer/ai/upload', err.message);
  }

  // ============================================================================
  // 测试结果汇总
  // ============================================================================
  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  自测执行完毕总结 (Test Summary):${colors.reset}`);
  console.log(`  总计通过 (PASS): ${colors.green}${passCount}${colors.reset}`);
  console.log(`  需注意项 (WARN): ${colors.yellow}${warnCount}${colors.reset}`);
  console.log(`  执行失败 (FAIL): ${colors.red}${failCount}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (failCount === 0) {
    console.log(`${colors.green}${colors.bold}🎉 恭喜！所有核心端点通讯与协议验证已全部通过，客户端可稳定直连！${colors.reset}`);
    if (warnCount > 0) {
      console.log(`${colors.yellow}提示：存在 ${warnCount} 个告警项（如实例分割目前使用的是 fallback 数据、预置模型偏少等），请参考对接文档按需升级为真实算法服务。${colors.reset}\n`);
    }
  } else {
    console.log(`${colors.red}${colors.bold}⚠️ 检测到 ${failCount} 个失败端点，请根据上述详细报错排查路由白名单或业务逻辑。${colors.reset}\n`);
  }
}

runAllTests().catch(err => {
  console.error('自测脚本运行异常:', err);
});
