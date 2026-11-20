/**
 * 组合式 API 2：输入草稿、芯片校验与不可变提交快照 (useComposerDraft)
 * 职责：
 *  - 维护用户提示词与 @素材 芯片
 *  - 芯片有效性校验（严禁静默 fallback，死芯片必须标红并阻断提交）
 *  - 生成不可变冻结快照 FrozenSubmitSnapshot
 */
import { ref, computed } from 'vue';
import { createFrozenSubmitSnapshot } from '@mls/api-contract';

export function useComposerDraft(options = {}) {
  const promptText = ref(options.initialPrompt || '');
  const modelKey = ref(options.initialModel || 'wan-2.1-t2v-plus');
  const aspectRatio = ref(options.initialRatio || '16:9');
  const resolution = ref(options.initialResolution || '720p');
  const referenceChips = ref([]); // [{ id, fid, name, type, valid, previewUrl }]
  const composerError = ref('');

  const hasInvalidChip = computed(() => {
    return referenceChips.value.some((c) => c.valid === false || !c.fid);
  });

  function addChip(asset) {
    if (!asset || !asset.fid) {
      referenceChips.value.push({
        id: `chip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fid: null,
        name: asset?.name || '未知素材',
        valid: false,
      });
      return;
    }
    referenceChips.value.push({
      id: `chip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fid: asset.fid,
      name: asset.file_name || asset.title || asset.name || asset.fid,
      type: asset.media_type || 'image',
      previewUrl: asset.preview_url || asset.thumbnail_url || '',
      valid: true,
    });
  }

  function removeChip(chipId) {
    referenceChips.value = referenceChips.value.filter((c) => c.id !== chipId);
  }

  /**
   * 严格校验输入草稿：
   * 遇失效/缺失素材绝不静默替换，强制阻断提交
   */
  function validateDraft() {
    composerError.value = '';
    const deadChips = referenceChips.value.filter((c) => c.valid === false || !c.fid);
    if (deadChips.length > 0) {
      composerError.value = `存在 ${deadChips.length} 个失效引用素材，已标红阻止发送，严禁静默替换`;
      return false;
    }
    return true;
  }

  /**
   * 创建不可变冻结提交快照
   */
  function buildFrozenSnapshot() {
    if (!validateDraft()) {
      return null;
    }
    const draft = {
      prompt: promptText.value.trim(),
      modelKey: modelKey.value,
      aspectRatio: aspectRatio.value,
      resolution: resolution.value,
      assets: referenceChips.value.map((c) => ({
        fid: c.fid,
        name: c.name,
        type: c.type,
      })),
    };
    return createFrozenSubmitSnapshot(draft);
  }

  function clearDraft() {
    promptText.value = '';
    referenceChips.value = [];
    composerError.value = '';
  }

  return {
    promptText,
    modelKey,
    aspectRatio,
    resolution,
    referenceChips,
    composerError,
    hasInvalidChip,
    addChip,
    removeChip,
    validateDraft,
    buildFrozenSnapshot,
    clearDraft,
  };
}
