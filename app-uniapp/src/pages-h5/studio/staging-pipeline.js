/**
 * staging-pipeline.js
 * 空间实景导演台原子化流水线调度器
 *
 * 负责将前端的多动作标注（新增/替换/消除）与可选的镜头拉远扩图，
 * 打包并调度至服务端执行，实现真正的一键原子化出片。
 */
import { uploadAiFile, submitAiTask, queryAiTaskById, queryAiTask } from '../../service/ViewerApi';
import {
  computeGroundPlaneFromQuad,
  computeGroundPlaneFromRect,
  calculateOutpaintPadding,
  remapCoordinates,
  buildFacingDesc,
} from './ground-perspective';

export class StagingPipeline {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  /**
   * 执行原子化空间改造流水线
   * @param {Object} params
   * @param {string} params.sceneImageBase64 - 原始实景图 Base64 或 URL
   * @param {number} params.imgWidth - 实景图宽度
   * @param {number} params.imgHeight - 实景图高度
   * @param {Array} params.actions - 动作列表 [{ id, type, selectionMode, points, rect, product, yaw, snapshotDataUrl, ... }]
   * @param {Object} params.expandConfig - 扩图设置 { enabled, targetRatio, zoomFactor, prompt }
   * @param {string} [params.fid] - 关联的资产 fid (可选)
   */
  async execute({
    sceneImageBase64,
    imgWidth = 1920,
    imgHeight = 1080,
    actions = [],
    expandConfig = { enabled: false },
    fid = 'temp_' + Date.now(),
  }) {
    if (!sceneImageBase64) {
      throw new Error('缺少源实景图');
    }
    if ((!actions || actions.length === 0) && !expandConfig.enabled) {
      throw new Error('未配置任何操作（请先标注新增/替换/消除区域，或开启扩图拉远）');
    }

    this.onStatusChange('正在准备流水线素材与参数...');
    this.onProgress(10);

    let activeImageBase64 = sceneImageBase64;
    let currentW = imgWidth;
    let currentH = imgHeight;
    let processedActions = JSON.parse(JSON.stringify(actions));

    // -------------------------------------------------------------
    // Step 1: 如果开启了【镜头拉远 / 画幅外扩】
    // -------------------------------------------------------------
    if (expandConfig && expandConfig.enabled) {
      this.onStatusChange('🚀 阶段 1/2: 正在执行智能画幅扩展与镜头拉远...');
      this.onProgress(25);

      const padInfo = calculateOutpaintPadding(
        currentW,
        currentH,
        expandConfig.targetRatio || '16:9',
        Number(expandConfig.zoomFactor || 0)
      );

      // 上传待扩图的原图
      let uploadedSceneUrl = '';
      try {
        const upRes = await uploadAiFile(activeImageBase64, 'scene_to_expand.jpg');
        uploadedSceneUrl = upRes?.url || upRes?.maskUrl || activeImageBase64;
      } catch (err) {
        uploadedSceneUrl = activeImageBase64;
      }

      // 发起扩图任务 (优先即梦/veImageX，服务端 handleExpand)
      try {
        const expandTask = await submitAiTask(fid, {
          type: 'expand',
          title: `镜头拉远扩图 (${padInfo.ratio})`,
          payload: {
            image: uploadedSceneUrl,
            expand_ratio: padInfo.ratio,
            pad_left: padInfo.padLeft,
            pad_right: padInfo.padRight,
            pad_top: padInfo.padTop,
            pad_bottom: padInfo.padBottom,
            zoom_factor: expandConfig.zoomFactor,
            prompt: expandConfig.prompt || '超写实室内房间视野延展，自然补全墙面、地板与天花板',
          },
        });

        // 轮询等待扩图完成
        const expandedResult = await this.pollTaskUntilDone(expandTask.task_id || expandTask.taskId, fid);
        if (expandedResult && expandedResult.outputUrl) {
          activeImageBase64 = expandedResult.outputUrl;
          currentW = padInfo.outW;
          currentH = padInfo.outH;
        }
      } catch (expandErr) {
        console.warn('[StagingPipeline] 扩图服务调用异常，回退至原画幅继续执行:', expandErr.message);
      }

      // 对所有待执行动作的选区坐标进行重映射
      processedActions = processedActions.map((act) => {
        if (act.selectionMode === 'quad' && Array.isArray(act.points)) {
          act.points = remapCoordinates(act.points, padInfo);
        } else if (act.rect) {
          act.rect = remapCoordinates(act.rect, padInfo);
        }
        return act;
      });

      this.onProgress(50);
    }

    // -------------------------------------------------------------
    // Step 2: 执行 3D 物品替换 / 新增 / 消除（调 Seedream 5.0 Pro）
    // -------------------------------------------------------------
    if (processedActions.length > 0) {
      this.onStatusChange('🎨 阶段 2/2: 正在执行 3D 产品精准对齐与微光融合...');
      this.onProgress(60);

      // 上传底图 (如果是第一步扩图产生的新图，或者原图)
      let baseSceneUrl = activeImageBase64;
      if (baseSceneUrl.startsWith('data:image/')) {
        try {
          const upRes = await uploadAiFile(baseSceneUrl, 'staging_base_scene.jpg');
          baseSceneUrl = upRes?.url || upRes?.maskUrl || baseSceneUrl;
        } catch (e) {}
      }

      // 处理主动作 (支持多个动作时按核心动作优先执行)
      const primaryAction = processedActions[0];

      // 提取选区与坐标
      let geoInfo = null;
      if (primaryAction.selectionMode === 'quad' && Array.isArray(primaryAction.points)) {
        geoInfo = computeGroundPlaneFromQuad(primaryAction.points, currentW, currentH);
      } else {
        geoInfo = computeGroundPlaneFromRect(primaryAction.rect, primaryAction.yaw || 0);
      }

      // 上传 3D 模型固定机位姿态截图 (若有)
      let refImageUrl = '';
      if (primaryAction.snapshotDataUrl) {
        try {
          const snapUp = await uploadAiFile(primaryAction.snapshotDataUrl, 'fixed_camera_model.png');
          refImageUrl = snapUp?.url || snapUp?.maskUrl || '';
        } catch (e) {
          console.warn('[StagingPipeline] 上传 3D 姿态参考图失败:', e.message);
        }
      }

      const taskType = primaryAction.type || 'replace'; // 'replace' | 'insert' | 'remove'
      const productName = primaryAction.product?.name || '该单品';
      const yaw = Number(primaryAction.yaw || geoInfo.yaw || 0);
      const facingSentence = buildFacingDesc(yaw, productName);

      const stagingPayload = {
        mode: taskType,
        action_type: taskType,
        image: baseSceneUrl,
        image_width: currentW,
        image_height: currentH,
        x1: geoInfo.bounds.minX,
        y1: geoInfo.bounds.minY,
        x2: geoInfo.bounds.maxX,
        y2: geoInfo.bounds.maxY,
        bbox_tag: geoInfo.bboxTag,
        product_name: productName,
        ref_image_url: refImageUrl,
        yaw,
        pitch: geoInfo.pitch,
        facing_sentence: facingSentence,
        pasteback: true,
        // 多动作元数据保留
        all_actions: processedActions,
      };

      const aiTask = await submitAiTask(fid, {
        type: taskType,
        title: `空间改造 (${taskType === 'replace' ? '替换' : taskType === 'insert' ? '新增' : '消除'} ${productName})`,
        payload: stagingPayload,
        ...stagingPayload,
      });

      this.onProgress(75);

      // 轮询最终生成结果
      const finalResult = await this.pollTaskUntilDone(aiTask.task_id || aiTask.taskId, fid);
      this.onProgress(100);
      this.onStatusChange('✅ 空间改造与实景出片已全部完成！');

      return {
        success: true,
        outputUrl: finalResult.outputUrl || finalResult.resultUrl || activeImageBase64,
        task: finalResult,
        actions: processedActions,
      };
    }

    // 仅扩图无后续家具动作的情况
    this.onProgress(100);
    this.onStatusChange('✅ 镜头拉远扩图已完成！');
    return {
      success: true,
      outputUrl: activeImageBase64,
      actions: [],
    };
  }

  /**
   * 轮询任务状态直至完成
   */
  async pollTaskUntilDone(taskId, fid, timeoutMs = 90000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = taskId ? await queryAiTaskById(taskId).catch(() => queryAiTask(fid)) : await queryAiTask(fid);
        if (res) {
          if (res.status === 'success' || res.status === 'done' || res.status === 'completed') {
            return res;
          }
          if (res.status === 'failed') {
            throw new Error(res.error || 'AI 任务处理失败');
          }
          if (res.progress) {
            this.onProgress(Math.min(95, 60 + Math.round((res.progress / 100) * 35)));
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('失败')) throw err;
      }
    }
    throw new Error('AI 任务执行超时，请稍后在任务列表查看');
  }
}
