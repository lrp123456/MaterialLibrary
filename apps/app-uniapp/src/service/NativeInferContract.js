/**
 * Android NCNN 原生桥接口约定（API_CONTRACT §13）
 * 接入步骤：
 * 1. 实现 UTS/原生模块，导出下列方法
 * 2. App 启动时：import { setNativeInfer } from './LocalModelRuntime'; setNativeInfer(impl)
 *
 * impl:
 * - isLoaded(modelId): boolean
 * - load(model: {id, version, fileName, ...}): Promise<void>
 * - unload(modelId): Promise<void>
 * - segment({modelId, inputSize, imagePath, points, box, width, height}):
 *     Promise<{maskPath: string, polygon: number[][], width: number, height: number}>
 * - upscale({modelId, scale, maxSide, tile, imagePath}):
 *     Promise<{outputPath: string}>
 * - downloadModel(model): Promise<void>
 */
export const NATIVE_INFER_CONTRACT = {
  segment: ['modelId', 'inputSize', 'imagePath', 'points', 'box', 'width', 'height'],
  upscale: ['modelId', 'scale', 'maxSide', 'tile', 'imagePath'],
  load: ['model'],
  unload: ['modelId'],
}

export default NATIVE_INFER_CONTRACT
