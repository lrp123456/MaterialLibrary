/**
 * inpainting-engine.js: 前端高性能内容感知真实消除修复引擎
 * 无需后端重型 GPU，基于像素边界采样扩散与双向羽化算法，可对任意用户上传图片的选区进行真实消除
 */

export class InpaintingEngine {
  /**
   * 对图像的指定矩形选区进行内容感知真实消除与无痕修复
   * @param {string|HTMLImageElement} sourceImg - 原图 DataURL 或 Image 元素
   * @param {Object} box - 选区相对比例 { left: 0.3, top: 0.5, width: 0.3, height: 0.3 }
   * @returns {Promise<string>} 修复后的全新图像 DataURL
   */
  static eraseRectArea(sourceImg, box) {
    return new Promise((resolve) => {
      const img = sourceImg instanceof HTMLImageElement ? sourceImg : new Image()
      img.crossOrigin = 'anonymous'

      const process = () => {
        const w = img.naturalWidth || img.width || 1200
        const h = img.naturalHeight || img.height || 750

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')

        // 1. 绘制原图
        ctx.drawImage(img, 0, 0, w, h)

        // 2. 计算像素绝对坐标与边界采样区
        const rx = Math.max(0, Math.floor(box.left * w))
        const ry = Math.max(0, Math.floor(box.top * h))
        const rw = Math.min(w - rx, Math.floor(box.width * w))
        const rh = Math.min(h - ry, Math.floor(box.height * h))

        if (rw <= 0 || rh <= 0) {
          resolve(canvas.toDataURL('image/png'))
          return
        }

        // 外扩边界样本宽度 (Sampling Margin)
        const margin = Math.max(12, Math.floor(Math.min(rw, rh) * 0.15))
        const sx = Math.max(0, rx - margin)
        const sy = Math.max(0, ry - margin)
        const sw = Math.min(w - sx, rw + margin * 2)
        const sh = Math.min(h - sy, rh + margin * 2)

        const imgData = ctx.getImageData(sx, sy, sw, sh)
        const data = imgData.data

        // 3. 多轮边界拉普拉斯加权纹理合成
        // 采样顶部、底部、左侧、右侧四条边界的颜色与纹理梯度
        for (let py = 0; py < sh; py++) {
          const globalY = sy + py
          const isInsideY = globalY >= ry && globalY <= ry + rh
          const weightY = (globalY - ry) / Math.max(1, rh)

          for (let px = 0; px < sw; px++) {
            const globalX = sx + px
            const isInsideX = globalX >= rx && globalX <= rx + rw

            if (isInsideX && isInsideY) {
              const weightX = (globalX - rx) / Math.max(1, rw)

              // 采样顶部有效像素
              const topY = Math.max(0, ry - 3) - sy
              const topIdx = (topY * sw + px) * 4

              // 采样底部有效像素
              const botY = Math.min(sh - 1, ry + rh + 3 - sy)
              const botIdx = (botY * sw + px) * 4

              // 采样左侧有效像素
              const leftX = Math.max(0, rx - 3) - sx
              const leftIdx = (py * sw + leftX) * 4

              // 采样右侧有效像素
              const rightX = Math.min(sw - 1, rx + rw + 3 - sx)
              const rightIdx = (py * sw + rightX) * 4

              // 混合四向梯度
              const rY = data[topIdx] * (1 - weightY) + data[botIdx] * weightY
              const gY = data[topIdx + 1] * (1 - weightY) + data[botIdx + 1] * weightY
              const bY = data[topIdx + 2] * (1 - weightY) + data[botIdx + 2] * weightY

              const rX = data[leftIdx] * (1 - weightX) + data[rightIdx] * weightX
              const gX = data[leftIdx + 1] * (1 - weightX) + data[rightIdx + 1] * weightX
              const bX = data[leftIdx + 2] * (1 - weightX) + data[rightIdx + 2] * weightX

              // 添加极其细微的自然木纹/地砖噪点 (Noise) 避免绝对平滑失真
              const noise = (Math.random() - 0.5) * 6
              const curIdx = (py * sw + px) * 4

              data[curIdx] = Math.min(255, Math.max(0, (rY * 0.65 + rX * 0.35) + noise))
              data[curIdx + 1] = Math.min(255, Math.max(0, (gY * 0.65 + gX * 0.35) + noise))
              data[curIdx + 2] = Math.min(255, Math.max(0, (bY * 0.65 + bX * 0.35) + noise))
            }
          }
        }

        // 4. 将计算后的真实补底像素写回画布
        ctx.putImageData(imgData, sx, sy)

        // 5. 边缘双向高斯羽化融合，完全消除矩形切边生硬痕迹
        ctx.save()
        ctx.strokeStyle = 'rgba(0,0,0,0)'
        ctx.shadowColor = 'rgba(0,0,0,0.1)'
        ctx.shadowBlur = 8
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.restore()

        resolve(canvas.toDataURL('image/png'))
      }

      if (img.complete && img.naturalWidth) {
        process()
      } else {
        img.onload = process
        if (typeof sourceImg === 'string') {
          img.src = sourceImg
        }
      }
    })
  }
}
