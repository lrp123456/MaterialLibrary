/**
 * 生成适配器按 model_code 严格匹配。
 * 禁止 list[0] / find(... true) 回落到其它厂商。
 */

function pickAdapterId(kind, modelCode, adapters) {
  const code = String(modelCode || '').toLowerCase();
  const list = Array.isArray(adapters) ? adapters : [];
  const findId = (pred) => {
    const hit = list.find(pred);
    return hit ? hit.id : null;
  };

  // 魔搭云端 Qwen：repo id 形如 Qwen/Qwen-Image-2.1-Turbo（带斜杠），或显式带 modelscope。
  // 必须排在下面 /qwen/ 的本机规则之前，否则云端模型会被路由到局域网 ncnn 适配器。
  const isModelScopeRepo = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(code);
  if (/qwen/i.test(code) && (code.includes('modelscope') || isModelScopeRepo)) {
    return findId((a) => a.id === 'qwenimage_modelscope' || String(a.protocol || '') === 'qwenimage_modelscope')
      || findId((a) => String(a.id).includes('modelscope'));
  }
  if (code.includes('modelscope') || isModelScopeRepo) {
    // 魔搭其它（非 Qwen）模型仍走通用 modelscope 适配器，别被云端 Qwen 抢走
    return findId((a) => a.id !== 'qwenimage_modelscope' && String(a.id).includes('modelscope'));
  }

  // 目录 model_code 是 qwen2.1-image，必须在 /-image$/ 的 Gemini 规则之前命中。
  if (code.includes('qwen')) {
    return findId((a) => a.id === 'qwenimage_local' || String(a.protocol || '') === 'qwenimage_local' || String(a.id).includes('qwenimage'));
  }
  if (code.includes('lyria')) {
    return findId((a) => a.id === 'gemini_lyria' || String(a.id).includes('lyria'));
  }
  if (code.includes('veo')) {
    return findId((a) => a.id === 'gemini_veo' || String(a.id).includes('veo'));
  }
  if (code.includes('omni')) {
    return findId((a) => a.id === 'gemini_video');
  }
  if (
    code.includes('nano') ||
    /-image$/.test(code) ||
    /gemini-.*-image/.test(code) ||
    code.includes('imagen') ||
    (kind === 'image' && code.includes('gemini'))
  ) {
    return findId((a) => a.id === 'gemini_image');
  }
  if (code.includes('gemini') && (kind === 'video' || kind === 'image')) {
    if (kind === 'video') return findId((a) => a.id === 'gemini_video');
    return findId((a) => a.id === 'gemini_image');
  }

  if (code.includes('agnes')) {
    if (kind === 'video') {
      return findId((a) => a.id === 'agnes_video' || String(a.id).includes('agnes_video'));
    }
    return findId((a) => a.id === 'agnes_image' || String(a.id).includes('agnes_image'));
  }
  if (code.includes('seedance') || (kind === 'video' && (code.includes('doubao') || code.includes('ark')))) {
    return findId((a) => a.id === 'ark_seedance' || String(a.id).includes('seedance'));
  }
  // ★ 音乐域必须落到真正的 music 适配器上。
  //   历史缺陷：`doubao-song-v5` / `doubao-bgm-v5` 会命中下面的 generic doubao 分支，
  //   被路由到 `ark_seedream`（图像端点）—— 提示词发错端点，必然失败且难以定位。
  //   ARK 当前并无 music/audio 域（见 PLAN.md Q1），所以这里宁可返回 null，
  //   让调用方抛出「未找到就绪的音乐适配器」，也不要回落到图像/视频适配器。
  if (kind === 'music') {
    if (code.includes('indextts') || code.includes('index-tts') || code.includes('index_tts')) {
      return findId((a) => a.id === 'indextts_local' || String(a.protocol || '') === 'indextts_local');
    }
    if (code.includes('acestep') || code.includes('ace-step') || code.includes('ace_step')) {
      return findId((a) => a.id === 'acestep_local' || String(a.protocol || '') === 'acestep_local');
    }
    // ARK 系音乐（豆包歌曲/BGM）必须有专属 music 适配器；没有就返回 null，
    // 不允许借用 gemini_lyria —— 那等于把豆包的提示词发到 Google 端点。
    if (code.includes('doubao') || code.includes('ark') || code.includes('song') || code.includes('bgm')) {
      return findId((a) => a.kind === 'music' && (a.id === 'doubao_music' || String(a.id).includes('doubao')));
    }
    return findId((a) => a.kind === 'music');
  }
  if (code.includes('seedream') || (kind === 'image' && (code.includes('doubao') || code.includes('ark')))) {
    return findId((a) => a.id === 'ark_seedream' || String(a.id).includes('seedream') || String(a.id).includes('ark_seedream'));
  }
  if (code.includes('modelscope') || code.startsWith('damo/')) {
    // 非 Qwen 的魔搭历史模型：不要回落到云端 Qwen 适配器
    return findId((a) => a.id !== 'qwenimage_modelscope' && String(a.id).includes('modelscope'));
  }
  if (code.includes('openai') || code.includes('dall-e')) {
    if (kind === 'video') return findId((a) => a.id === 'openai_videos');
    return findId((a) => a.id === 'openai_images' || (String(a.id).includes('openai') && !String(a.id).includes('video')));
  }
  return null;
}

function pickAdapterRow(kind, modelCode, adapters) {
  const id = pickAdapterId(kind, modelCode, adapters);
  if (!id) return null;
  return (adapters || []).find((a) => a.id === id) || null;
}

function isGoogleModel(modelCode) {
  const c = String(modelCode || '').toLowerCase();
  return c.includes('gemini') || c.includes('veo') || c.includes('lyria') || c.includes('nano') || c.includes('imagen');
}

function googleAdapterMissingError(kind, modelCode) {
  const code = String(modelCode || '').toLowerCase();
  if (code.includes('lyria')) {
    return 'Google Lyria 音乐适配器未就绪。请配置 Gemini API Key（llm_providers.gemini）并启用 gemini_lyria，不要回落到其他厂商。';
  }
  if (code.includes('veo')) {
    return 'Google Veo 视频适配器未就绪。请配置 Gemini API Key 并启用 gemini_veo，不要回落到 Omni/Agnes/Ark。';
  }
  if (code.includes('omni')) {
    return 'Google Gemini Omni 视频适配器未就绪。请配置 Gemini API Key 并启用 gemini_video，不要回落到 Agnes/Ark。';
  }
  if (kind === 'image' || code.includes('nano') || /-image$/.test(code)) {
    return 'Google 图像适配器未就绪。请配置 Gemini API Key 并启用 gemini_image，不要回落到 Seedream/Agnes。';
  }
  return 'Google 生成适配器未就绪。请配置 Gemini API Key 并启用对应适配器，不要回落到 Agnes/Ark。';
}

function adapterMissingError(kind, modelCode) {
  if (isGoogleModel(modelCode)) return googleAdapterMissingError(kind, modelCode);
  const k = kind === 'video' ? '视频' : kind === 'music' ? '音乐' : '图片';
  const code = String(modelCode || '').trim();
  return code
    ? `未找到与模型 ${code} 匹配的就绪${k}适配器（禁止回落到其它厂商）`
    : `未找到就绪的${k}生成适配器`;
}

module.exports = {
  pickAdapterId,
  pickAdapterRow,
  isGoogleModel,
  googleAdapterMissingError,
  adapterMissingError,
};
