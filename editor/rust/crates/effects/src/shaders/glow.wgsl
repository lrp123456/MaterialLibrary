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

// 发光：亮部提取 + 8 方向 × 2 半径环形采样 + 加性合成。
// scalars.x = threshold 亮度阈值(0..1)
// scalars.y = intensity 强度(0..3)
// scalars.z = radius    采样半径(px)
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel = vec2f(1.0, 1.0) / uniforms.resolution;
    let base = textureSample(input_texture, input_sampler, input.tex_coord);
    let threshold = uniforms.scalars.x;
    let intensity = uniforms.scalars.y;
    let radius = max(uniforms.scalars.z, 0.5);

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

    var glow = vec3f(0.0);
    var weight_sum = 0.0;

    for (var i = 0; i < 8; i = i + 1) {
        for (var r = 1; r <= 2; r = r + 1) {
            let offset = dirs[i] * texel * radius * f32(r);
            let sample_color = textureSample(
                input_texture,
                input_sampler,
                input.tex_coord + offset
            ).rgb;
            let bright = max(sample_color - vec3f(threshold), vec3f(0.0));
            glow = glow + bright;
            weight_sum = weight_sum + 1.0;
        }
    }

    glow = glow / max(weight_sum, 1.0);
    let out_rgb = base.rgb + glow * intensity;
    return vec4f(out_rgb, base.a);
}
