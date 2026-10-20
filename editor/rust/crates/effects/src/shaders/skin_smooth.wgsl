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

// 磨皮：双边滤波近似（保边平滑）。
// scalars.x = strength 强度(0..1)，直接作为混合比例
// scalars.y = radius   采样半径(px)
// 只做全局平滑，不做人脸检测；色调/美白交给调色或 LUT。
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel = vec2f(1.0, 1.0) / uniforms.resolution;
    let strength = clamp(uniforms.scalars.x, 0.0, 1.0);
    let radius = max(uniforms.scalars.y, 0.5);

    let center = textureSample(input_texture, input_sampler, input.tex_coord);
    let center_rgb = center.rgb;

    // 颜色容差：强度越大越宽容，避免把五官边缘也抹平
    let sigma_color = mix(0.02, 0.12, strength);
    let inv_two_sigma_sq = 1.0 / (2.0 * sigma_color * sigma_color);

    let dirs = array<vec2f, 8>(
        vec2f(1.0, 0.0),
        vec2f(0.7071, 0.7071),
        vec2f(0.0, 1.0),
        vec2f(-0.7071, 0.7071),
        vec2f(-1.0, 0.0),
        vec2f(-0.7071, -0.7071),
        vec2f(0.0, -1.0),
        vec2f(0.7071, -0.7071)
    );

    var sum = vec3f(0.0);
    var weight_sum = 0.0;

    for (var i = 0; i < 8; i = i + 1) {
        let offset = dirs[i] * texel * radius;
        let sample_color = textureSample(
            input_texture,
            input_sampler,
            input.tex_coord + offset
        ).rgb;
        let diff = sample_color - center_rgb;
        let dist_sq = dot(diff, diff);
        let weight = exp(-dist_sq * inv_two_sigma_sq);
        sum = sum + sample_color * weight;
        weight_sum = weight_sum + weight;
    }

    let smoothed = sum / max(weight_sum, 0.0001);
    let out_rgb = mix(center_rgb, smoothed, strength * 0.9);
    return vec4f(out_rgb, center.a);
}
