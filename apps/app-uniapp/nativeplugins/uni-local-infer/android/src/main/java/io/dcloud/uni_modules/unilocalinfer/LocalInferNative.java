package io.dcloud.uni_modules.unilocalinfer;

/**
 * JNI 入口。so：liblocalinfer.so
 * 自定义调试基座 / 整包 APK 通过 plus.android.importClass 调用。
 */
public final class LocalInferNative {
    static {
        try {
            System.loadLibrary("localinfer");
        } catch (Throwable ignored) {
        }
    }

    private LocalInferNative() {}

    public static native void load(String modelId, String paramPath, String binPath, String auxParam, String auxBin);

    public static native void unload(String modelId);

    public static native boolean isLoaded(String modelId);

    public static native String segmentPoint(String modelId, String imagePath, int inputSize, String pointsJson);

    public static native String segmentBox(String modelId, String imagePath, int inputSize, String boxJson);

    public static native String upscale(String modelId, String imagePath, int scale, int maxSide, int tile);
}
