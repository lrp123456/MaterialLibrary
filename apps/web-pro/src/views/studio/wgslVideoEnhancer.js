/**
 * wgslVideoEnhancer.js
 * 基于 WebGPU 与 WGSL 的视频外部纹理零拷贝直读与自适应对比度超清锐化 (CAS) 引擎
 * 
 * 优势：
 * 1. 显存零拷贝：利用 WebGPU 原生 importExternalTexture 直接映射 <video> 硬件解码帧，不经过 CPU 拷贝；
 * 2. WGSL 硬件级对比度自适应锐化 (Contrast-Adaptive Sharpening, CAS)：在 GPU 着色器中动态重构高频纹理细节，消除糊感；
 * 3. 优雅降级：若浏览器环境未开启 WebGPU 或硬件不支持，抛出可读原因并优雅退出。
 */

const WGSL_SHADER_SOURCE = `
struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var uvs = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );
  var output : VertexOutput;
  output.Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  output.uv = uvs[VertexIndex];
  return output;
}

@group(0) @binding(0) var mySampler : sampler;
@group(0) @binding(1) var myTexture : texture_external;

// WGSL 自适应对比度锐化与清晰度增强 (CAS)
@fragment
fn frag_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let texSize = vec2<f32>(textureDimensions(myTexture));
  let dx = 1.0 / texSize.x;
  let dy = 1.0 / texSize.y;

  let c = textureSampleBaseClampToEdge(myTexture, mySampler, uv).rgb;
  let a = textureSampleBaseClampToEdge(myTexture, mySampler, uv + vec2<f32>(-dx, 0.0)).rgb;
  let b = textureSampleBaseClampToEdge(myTexture, mySampler, uv + vec2<f32>(dx, 0.0)).rgb;
  let d = textureSampleBaseClampToEdge(myTexture, mySampler, uv + vec2<f32>(0.0, -dy)).rgb;
  let e = textureSampleBaseClampToEdge(myTexture, mySampler, uv + vec2<f32>(0.0, dy)).rgb;

  let min_rgb = min(c, min(min(a, b), min(d, e)));
  let max_rgb = max(c, max(max(a, b), max(d, e)));
  let diff = max_rgb - min_rgb;

  let amp = clamp(diff / (max_rgb + vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  let w = -sqrt(amp) * 0.16;

  let sharp = (c + (a + b + d + e) * w) / (1.0 + 4.0 * w);
  return vec4<f32>(clamp(sharp, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

export class WgslVideoEnhancer {
  constructor() {
    this.isSupported = false;
    this.isReady = false;
    this.adapter = null;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.format = null;
    this.canvas = null;
  }

  static checkSupport() {
    return Boolean(
      typeof navigator !== 'undefined' &&
      navigator.gpu &&
      typeof navigator.gpu.requestAdapter === 'function' &&
      window.isSecureContext
    );
  }

  async init(canvas) {
    if (!WgslVideoEnhancer.checkSupport()) {
      throw new Error('当前浏览器环境未开放 WebGPU API 支持（需现代 Chromium 113+ 并在 HTTPS 安全上下文中运行）');
    }

    this.canvas = canvas;

    // 优先尝试高性能显卡
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    }).catch(() => null);

    // 兜底默认显卡适配器
    if (!this.adapter) {
      this.adapter = await navigator.gpu.requestAdapter().catch(() => null);
    }

    if (!this.adapter) {
      throw new Error('未获取到可用的 GPU 硬件适配器，请在浏览器地址栏检查 chrome://gpu 是否开启 WebGPU');
    }

    // 全程使用局部变量，任何一步失败都要 destroy 已申请的 device，避免 GPU 资源泄漏
    const device = await this.adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) {
      try { device.destroy(); } catch (_) {}
      throw new Error('Canvas 获取 webgpu 渲染上下文失败（可能该画布已绑定了 2d 上下文）');
    }

    try {
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format,
        alphaMode: 'opaque'
      });

      const shaderModule = device.createShaderModule({
        code: WGSL_SHADER_SOURCE
      });

      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vert_main'
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'frag_main',
          targets: [{ format }]
        },
        primitive: {
          topology: 'triangle-strip',
          stripIndexFormat: undefined
        }
      });

      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
      });

      // 设备丢失（驱动崩溃/资源超限）后标记不可用，调用方自动退回 2D 渲染
      device.lost.then((info) => {
        if (this.device === device) {
          this.isReady = false;
          console.warn('[WGSL] WebGPU device lost:', info && (info.message || info.reason));
        }
      }).catch(() => {});

      this.device = device;
      this.context = context;
      this.format = format;
      this.pipeline = pipeline;
      this.sampler = sampler;
      this.isSupported = true;
      this.isReady = true;
      return true;
    } catch (e) {
      try { device.destroy(); } catch (_) {}
      throw e;
    }
  }

  renderFrame(videoElement, width, height) {
    if (!this.isReady || !this.device || !this.context || !videoElement || videoElement.readyState < 2) {
      return false;
    }

    try {
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.context.configure({
          device: this.device,
          format: this.format,
          alphaMode: 'opaque'
        });
      }

      const externalTexture = this.device.importExternalTexture({
        source: videoElement
      });

      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: externalTexture }
        ]
      });

      const commandEncoder = this.device.createCommandEncoder();
      const textureView = this.context.getCurrentTexture().createView();

      const renderPassDescriptor = {
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      };

      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4);
      passEncoder.end();

      this.device.queue.submit([commandEncoder.finish()]);
      return true;
    } catch (err) {
      console.warn('[WGSL] 帧着色渲染异常:', err);
      return false;
    }
  }

  destroy() {
    if (this.device) {
      try { this.device.destroy(); } catch (_) {}
    }
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.sampler = null;
    this.isReady = false;
    this.isSupported = false;
  }
}
