struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

// 调色：亮度 → 对比度(以 0.5 为轴) → 饱和度 → 色温(R/B 偏移) → 反相。
// scalars.x = 亮度   (-1..1, 0 不改变)
// scalars.y = 对比度 (-1..1, 0 不改变)
// scalars.z = 饱和度 (-1..1, 0 不改变)
// scalars.w = 色温   (-1..1, 负值偏冷 / 正值偏暖)
// direction.x >= 0.5 时启用反相（复用方向槽做开关，不新增 uniform）
// 全帧单输入单输出，可安全串联多 pass。
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);

    let brightness = clamp(uniforms.scalars.x, -1.0, 1.0);
    let contrast = clamp(uniforms.scalars.y, -1.0, 1.0);
    let saturation = clamp(uniforms.scalars.z, -1.0, 1.0);
    let temperature = clamp(uniforms.scalars.w, -1.0, 1.0);

    var rgb = tex.rgb;

    // 1) 亮度：整体加性偏移
    rgb = rgb + vec3f(brightness);

    // 2) 对比度：以 0.5 为轴缩放，-1 压成灰，+1 拉满
    let contrast_factor = 1.0 + contrast;
    rgb = (rgb - vec3f(0.5)) * contrast_factor + vec3f(0.5);

    // 3) 饱和度：向亮度轴插值 / 远离
    let luma = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    rgb = mix(vec3f(luma), rgb, 1.0 + saturation);

    // 4) 色温：暖色抬 R 压 B，冷色反之
    let warm = temperature * 0.12;
    rgb = rgb + vec3f(warm, warm * 0.25, -warm);

    // 5) 反相：mode 位开关
    if (uniforms.direction.x >= 0.5) {
        rgb = vec3f(1.0) - rgb;
    }

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
