package io.dcloud.uni_modules.unilocalinfer;

import android.app.Activity;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

import io.dcloud.feature.uniapp.annotation.UniJSMethod;
import io.dcloud.feature.uniapp.common.UniModule;

/**
 * Vue3 app-plus 原生模块：把 NCNN JNI 暴露给 JS。
 */
public class LocalInferModule extends UniModule {
    @UniJSMethod(uiThread = false)
    public JSONObject ensureModels() {
        JSONObject out = new JSONObject();
        try {
            Activity act = mUniSDKInstance.getContext() instanceof Activity
                    ? (Activity) mUniSDKInstance.getContext()
                    : null;
            if (act == null) {
                out.put("ok", false);
                out.put("error", "no activity");
                return out;
            }
            File root = new File(act.getFilesDir(), "local-models");
            copyAssetDir(act.getAssets(), "local-models/edge_sam_mobile", new File(root, "edge_sam_mobile"));
            copyAssetDir(act.getAssets(), "local-models/realesrgan_x4_ncnn", new File(root, "realesrgan_x4_ncnn"));
            out.put("ok", true);
            out.put("dir", root.getAbsolutePath());
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return out;
    }

    @UniJSMethod(uiThread = false)
    public JSONObject load(JSONObject opts) {
        JSONObject out = new JSONObject();
        try {
            String id = opts.optString("modelId");
            String param = opts.optString("paramPath");
            String bin = opts.optString("binPath");
            String auxP = opts.optString("auxParam", "");
            String auxB = opts.optString("auxBin", "");
            LocalInferNative.load(id, param, bin, auxP, auxB);
            out.put("ok", true);
            out.put("loaded", LocalInferNative.isLoaded(id));
        } catch (Throwable e) {
            try {
                out.put("ok", false);
                out.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {}
        }
        return out;
    }

    @UniJSMethod(uiThread = false)
    public JSONObject unload(JSONObject opts) {
        JSONObject out = new JSONObject();
        try {
            LocalInferNative.unload(opts.optString("modelId"));
            out.put("ok", true);
        } catch (Throwable e) {
            try {
                out.put("ok", false);
                out.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {}
        }
        return out;
    }

    @UniJSMethod(uiThread = false)
    public JSONObject isLoaded(JSONObject opts) {
        JSONObject out = new JSONObject();
        try {
            boolean v = LocalInferNative.isLoaded(opts.optString("modelId"));
            out.put("ok", true);
            out.put("loaded", v);
        } catch (Throwable e) {
            try {
                out.put("ok", false);
                out.put("loaded", false);
            } catch (Exception ignored) {}
        }
        return out;
    }

    @UniJSMethod(uiThread = false)
    public String segmentPoint(JSONObject opts) {
        try {
            return LocalInferNative.segmentPoint(
                    opts.optString("modelId"),
                    opts.optString("imagePath"),
                    opts.optInt("inputSize", 1024),
                    opts.optString("pointsJson", "[]")
            );
        } catch (Throwable e) {
            return "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\",\"code\":\"jni\"}";
        }
    }

    @UniJSMethod(uiThread = false)
    public String segmentBox(JSONObject opts) {
        try {
            return LocalInferNative.segmentBox(
                    opts.optString("modelId"),
                    opts.optString("imagePath"),
                    opts.optInt("inputSize", 1024),
                    opts.optString("boxJson", "{}")
            );
        } catch (Throwable e) {
            return "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\",\"code\":\"jni\"}";
        }
    }

    @UniJSMethod(uiThread = false)
    public String upscale(JSONObject opts) {
        try {
            return LocalInferNative.upscale(
                    opts.optString("modelId"),
                    opts.optString("imagePath"),
                    opts.optInt("scale", 4),
                    opts.optInt("maxSide", 1024),
                    opts.optInt("tile", 256)
            );
        } catch (Throwable e) {
            return "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\",\"code\":\"jni\"}";
        }
    }

    @UniJSMethod(uiThread = false)
    public String filesDir() {
        try {
            Activity act = mUniSDKInstance.getContext() instanceof Activity
                    ? (Activity) mUniSDKInstance.getContext()
                    : null;
            if (act == null) return "";
            return new File(act.getFilesDir(), "local-models").getAbsolutePath();
        } catch (Exception e) {
            return "";
        }
    }

    private static void copyAssetDir(AssetManager am, String assetDir, File destDir) throws Exception {
        destDir.mkdirs();
        String[] names;
        try {
            names = am.list(assetDir);
        } catch (Exception e) {
            return;
        }
        if (names == null) return;
        for (String name : names) {
            String child = assetDir + "/" + name;
            String[] sub = am.list(child);
            if (sub != null && sub.length > 0) {
                copyAssetDir(am, child, new File(destDir, name));
            } else {
                File out = new File(destDir, name);
                if (out.exists() && out.length() > 0) continue;
                InputStream in = am.open(child);
                FileOutputStream fos = new FileOutputStream(out);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
                fos.close();
                in.close();
            }
        }
    }
}
