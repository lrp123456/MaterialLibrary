# 多端适配说明（本地推理）

```
                    ┌─────────────────────────┐
                    │  LocalModelRuntime (JS) │
                    │  互斥装载 / 页内常驻     │
                    └───────────┬─────────────┘
                                │ createLocalInfer()
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   Android NCNN           HarmonyOS NEXT            iOS
   uni-local-infer        MindSpore Lite/HiAI       CoreML/MPS
   EdgeSAM + ESRGAN       同模型资产（转 OM/MSL）    同资产（转 mlmodel）
   Mate70 4.3 APK         纯血 HAP                  App Store
```

## 原则

1. **业务层只认 JS API**（segment / upscale / load / unload）  
2. **模型 id / version / exclusiveGroup 全端一致**，格式可换（ncnn ↔ om ↔ mlmodel）  
3. **服务端 `/lab/local-models` 按平台下发不同文件**（可加 `platform` query）  

## 服务端建议扩展

```
GET /lab/local-models?platform=android|harmony|ios
downloadUrl 指向对应格式包
```

## 现状

| 端 | 状态 |
|----|------|
| Android 4.3 APK | UTS + JNI 骨架已就位；需编入 ncnn so 与 EdgeSAM 权重 |
| 鸿蒙 NEXT | 接口占位；模型转 OM 后填 `app-harmony` |
| iOS | 接口占位；CoreML 后填 `app-ios` |

前端 `editor.vue` / `LocalModelRuntime` **已按统一 API 写好**，原生 so 就绪后 `setNativeInfer(createLocalInfer())` 即可真跑；未接入时自动回落服务端 YOLO 或提示涂抹。
