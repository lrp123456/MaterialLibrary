<template>
  <div class="flex-1 flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-studio-950 p-7 overflow-y-auto scrollbar-thin">
    <div class="max-w-4xl mx-auto space-y-7">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between pb-4 border-b border-studio-700">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2.5">
            <StudioIcon name="settings" :size="20" class="text-studio-accent" />
            系统设置与中枢配置
          </h2>
          <p class="text-sm text-slate-300 mt-1 font-medium">管理 AI 模型引擎、灰度发布分发、网关分流策略与 NAS 存储连接</p>
        </div>
        <div class="flex items-center space-x-2 text-xs">
          <span class="w-2.5 h-2.5 rounded-full bg-studio-emerald animate-pulse"></span>
          <span class="text-emerald-400 font-mono font-bold">后端服务连接正常 (:30001)</span>
        </div>
      </div>

      <!-- 设置模块 1：AI 推理模型网关与火山方舟配置 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="sparkles" :size="16" class="text-studio-accent" />
          AI 模型引擎与火山方舟密钥
        </h3>
        <div class="grid grid-cols-2 gap-4 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">生图默认模型</label>
            <input value="doubao-seed-2-0 (Seedream 5.0 Flash)" disabled class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium" />
          </div>
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">生视频默认模型</label>
            <input value="doubao-seedance-2-0-lite" disabled class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium" />
          </div>
          <div class="col-span-2">
            <label class="text-slate-300 font-semibold block mb-1.5">火山方舟 API Key</label>
            <div class="flex space-x-2.5">
              <input type="password" value="volc_sk_********************************" disabled class="flex-1 bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs font-medium" />
              <button class="px-4 py-2.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-white text-xs font-bold border border-studio-700 cursor-pointer">更新密钥</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 设置模块 2：灰度发布与应用更新管理 (白名单控制) -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="cloud" :size="16" class="text-cyan-400" />
            App 灰度更新通道与设备白名单
          </h3>
          <span class="text-xs text-amber-300 bg-amber-400/15 px-2.5 py-1 rounded-md border border-amber-400/40 font-mono font-bold">
            当前基准: v1.0.4 (2040003)
          </span>
        </div>
        <div class="space-y-3.5 text-xs">
          <div>
            <label class="text-slate-300 font-semibold block mb-1.5">灰度测试目标机器号 / 设备白名单 (逗号分隔)</label>
            <textarea
              rows="2"
              placeholder="输入设备机器号，例如：4, test_device_a"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-3 text-white font-mono text-xs outline-none"
            >4</textarea>
            <span class="text-xs text-slate-400 mt-1.5 block font-medium">
              已启用白名单校验机制，非白名单设备即使触发更新检查也不会收到灰度测试包。
            </span>
          </div>
          <div class="flex justify-end">
            <button class="px-5 py-2.5 rounded-xl bg-studio-accent text-white font-bold text-xs shadow cursor-pointer">保存白名单配置</button>
          </div>
        </div>
      </div>

      <!-- 设置模块 3：网关分流与人脸可见性审核策略 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-3.5 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="sliders" :size="16" class="text-studio-indigo" />
          网关分流与分类互斥审核规则
        </h3>
        <p class="text-xs text-slate-300 leading-relaxed font-normal">
          已生效规则：当图片中无法清晰完整识别出人体面部轮廓特征时，系统将坚决拒绝分流至【虚拟人像】库，自动修正归类为【服装服饰】或【空间素材】。
        </p>
        <div class="flex items-center space-x-2 text-xs text-emerald-400 font-semibold">
          <StudioIcon name="check" :size="15" />
          <span>VLM 人脸互斥阻断规则已全面生效并在图 4 资产验证通过</span>
        </div>
      </div>

      <!-- 设置模块 4：存储路径与 NAS 挂载状态 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-3.5 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="building" :size="16" class="text-slate-300" />
          存储路径与 NAS 挂载状态
        </h3>
        <div class="grid grid-cols-2 gap-3.5 text-xs font-mono">
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <span class="text-slate-400 text-xs block mb-1">本地数据库 (SQLite)</span>
            <span class="text-white font-semibold">/home/lrp/.dsh-material-library/material.db</span>
          </div>
          <div class="p-3 rounded-xl bg-studio-950 border border-studio-700">
            <span class="text-slate-400 text-xs block mb-1">NAS 存储挂载点</span>
            <span class="text-white font-semibold">/mnt/synology/material</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import StudioIcon from '../components/StudioIcon.vue';
</script>
