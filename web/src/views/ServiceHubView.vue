<template>
  <div class="h-full flex flex-col space-y-3 p-3 sm:p-6 max-w-7xl mx-auto">
    <!-- 顶部状态栏与控制条 -->
    <div class="bg-surface-low border border-outline-variant rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 flex-none">
      <div>
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-xl">dns</span>
          <h1 class="text-sm font-bold text-white">服务总控中枢 (Service Hub)</h1>
          <span
            class="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1.5"
            :class="isOnline ? 'bg-ok/15 text-ok' : isChecking ? 'bg-primary/15 text-primary-dim' : 'bg-err/15 text-err'"
          >
            <span class="w-1.5 h-1.5 rounded-full" :class="isOnline ? 'bg-ok animate-pulse' : isChecking ? 'bg-primary-dim animate-ping' : 'bg-err'"></span>
            <span>{{ isOnline ? '在线 (3790 正常监听)' : isChecking ? '探测连通性...' : '离线 (未启动)' }}</span>
          </span>
        </div>
        <p class="text-[11px] text-on-surface-variant mt-1 leading-relaxed">
          双模一体化架构：独立常驻 Windows 宿主带外控制进程 · 支持服务端进程全生命周期维护与紧急脱困
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="checkStatus"
          :disabled="isChecking"
          class="px-3 py-1.5 rounded-xl bg-surface border border-outline-variant hover:bg-surface-high text-on-surface text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': isChecking }">sync</span>
          <span>探活检测</span>
        </button>

        <a
          :href="hubUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
        >
          <span class="material-symbols-outlined text-sm">open_in_new</span>
          <span>独立窗口弹出</span>
        </a>
      </div>
    </div>

    <!-- 主展示区 -->
    <div class="flex-1 min-h-[620px] bg-surface-low border border-outline-variant rounded-2xl overflow-hidden relative flex flex-col">
      <!-- 在线状态：嵌入式总控中枢 iframe -->
      <iframe
        v-if="isOnline"
        :src="hubUrl"
        class="w-full h-full flex-1 border-0 rounded-2xl bg-canvas"
        title="Service Hub Console"
      ></iframe>

      <!-- 离线/检测失败状态：展示带外脱困引导与启动指引 -->
      <div v-else class="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-xl mx-auto space-y-4">
        <div class="w-16 h-16 rounded-2xl bg-surface border border-outline-variant flex items-center justify-center text-outline">
          <span class="material-symbols-outlined text-3xl">power_off</span>
        </div>

        <div class="space-y-1.5">
          <h2 class="text-base font-bold text-white">总控中枢暂未连接</h2>
          <p class="text-xs text-on-surface-variant leading-relaxed">
            检测到 <span class="font-mono text-cyan">{{ hubUrl }}</span> 无法访问。<br />
            服务总控设计为<b>宿主独立常驻进程</b>，独立于当前 30001 服务端运行。
          </p>
        </div>

        <!-- 架构设计优势卡片 -->
        <div class="w-full text-left bg-surface rounded-xl p-3.5 border border-outline-variant text-xs space-y-2">
          <div class="font-semibold text-white flex items-center gap-1.5">
            <span class="material-symbols-outlined text-primary text-sm">shield</span>
            <span>为什么 Service Hub 需要独立于服务端运行？</span>
          </div>
          <ul class="text-[11px] text-on-surface-variant space-y-1 list-disc list-inside">
            <li><b>带外脱困保障</b>：当服务端发生代码升级、全量重载、死循环或端口崩溃时，总控面板不受影响，依然能一键重启 WSL 服务。</li>
            <li><b>跨环境调度</b>：统一协调 WSL 容器进程（30001/30002）与 Windows 本地原生工具（Pack Studio 3789、adb 手机调试推流）。</li>
            <li><b>防连带故障</b>：服务端业务压力激增不会冲垮底层守护与监控中枢。</li>
          </ul>
        </div>

        <!-- 启动引导步骤 -->
        <div class="w-full text-left bg-surface-high/40 rounded-xl p-3.5 border border-primary/20 text-xs space-y-2">
          <div class="font-semibold text-primary-dim flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">play_circle</span>
            <span>如何启动服务总控中枢？</span>
          </div>
          <div class="space-y-2 text-[11px] text-on-surface-variant">
            <p><b>方法一（推荐）：</b>在项目根目录直接双击运行脚本：</p>
            <div class="p-2 rounded bg-canvas font-mono text-white text-[11px] border border-outline-variant flex items-center justify-between">
              <span>素材库控制台.bat</span>
              <span class="text-[10px] text-outline">Windows 一键启动</span>
            </div>
            <p><b>方法二（命令行）：</b>在 Windows 终端中执行启动命令：</p>
            <div class="p-2 rounded bg-canvas font-mono text-cyan text-[11px] border border-outline-variant select-all">
              node service-hub/server.js
            </div>
          </div>
        </div>

        <div class="pt-2">
          <button
            @click="checkStatus"
            :disabled="isChecking"
            class="px-5 py-2 rounded-xl bg-primary hover:bg-primary-dim text-white text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
          >
            <span class="material-symbols-outlined text-sm" :class="{ 'animate-spin': isChecking }">sync</span>
            <span>启动后点击重新探测</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const isOnline = ref(false)
const isChecking = ref(false)
const hostname = typeof window !== 'undefined' ? (window.location.hostname || '127.0.0.1') : '127.0.0.1'
const hubUrl = `http://${hostname}:3790`

let timer = null

async function checkStatus() {
  isChecking.value = true
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    // 利用 mode: 'no-cors' 探测端口连通性，即便 SEC-004 响应头也可感知是否通网
    await fetch(`${hubUrl}/`, {
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store'
    })
    clearTimeout(timeoutId)
    isOnline.value = true
  } catch (e) {
    isOnline.value = false
  } finally {
    isChecking.value = false
  }
}

onMounted(() => {
  checkStatus()
  timer = setInterval(checkStatus, 15000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>
