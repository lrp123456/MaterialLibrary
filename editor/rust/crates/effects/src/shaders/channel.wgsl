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

// 通道处理：缩放 / 着色(Tint 近似) / 去色偏。
// scalars.x/y/z = R/G/B 权重(0..2，默认 1 = 不改变)
// scalars.w     = mode 0=通道缩放 1=着色 tint 2=去色偏
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);
    let weights = clamp(uniforms.scalars.xyz, vec3f(0.0), vec3f(2.0));
    let mode = i32(round(clamp(uniforms.scalars.w, 0.0, 2.0)));
    let safe = max(weights, vec3f(0.05));

    var rgb = tex.rgb;

    if (mode == 0) {
        // 通道缩放：等价 Channel Mixer 的增益段
        rgb = rgb * weights;
    } else if (mode == 1) {
        // 着色：亮度重映射到单色调，权重决定色调（归一化到最大分量为 1）
        let peak = max(safe.x, max(safe.y, safe.z));
        let tint = safe / peak;
        let luma = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
        rgb = vec3f(luma) * tint;
    } else {
        // 去色偏：按通道倒数补偿，把偏色拉回中性
        rgb = rgb / safe;
    }

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
