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

// 锐化：4 邻域反锐化掩模（unsharp mask）。
// scalars.x = amount 强度(0..3)
// scalars.y = radius 采样半径(px)
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let texel = vec2f(1.0, 1.0) / uniforms.resolution;
    let amount = uniforms.scalars.x;
    let radius = max(uniforms.scalars.y, 0.5);
    let step_uv = texel * radius;

    let center = textureSample(input_texture, input_sampler, input.tex_coord);

    let up = textureSample(input_texture, input_sampler, input.tex_coord + vec2f(0.0, -step_uv.y)).rgb;
    let down = textureSample(input_texture, input_sampler, input.tex_coord + vec2f(0.0, step_uv.y)).rgb;
    let left = textureSample(input_texture, input_sampler, input.tex_coord + vec2f(-step_uv.x, 0.0)).rgb;
    let right = textureSample(input_texture, input_sampler, input.tex_coord + vec2f(step_uv.x, 0.0)).rgb;

    let neighborhood = (up + down + left + right) * 0.25;
    let high_freq = center.rgb - neighborhood;
    let out_rgb = center.rgb + high_freq * amount;

    return vec4f(out_rgb, center.a);
}
