struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: array<vec4f, 16>,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

// 64 个标量按 vec4 成组存放：WebGPU 要求 uniform 数组的 stride 是 16 的倍数，
// 所以不能直接写 array<f32, 64>。sc(i) 把它还原成"第 i 个浮点槽"。
fn sc(i: u32) -> f32 {
    return uniforms.scalars[i / 4u][i % 4u];
}

// 高光 / 阴影：按亮度分段各自加减，中间调几乎不动。
// 纯乘法拉不动死黑（0 乘任何数还是 0），所以暗部段带一个加性分量。
// scalars[0] = 阴影 -1..1（正值提亮暗部）
// scalars[1] = 高光 -1..1（正值压亮亮部）
// scalars[2] = 阴影分界 0.05..0.9（亮度高于此就不再受阴影影响）
// scalars[3] = 高光分界 0.1..0.98（亮度低于此就不再受高光影响）
const LUMA = vec3f(0.2126, 0.7152, 0.0722);

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);

    let shadows = clamp(sc(0u), -1.0, 1.0);
    let highlights = clamp(sc(1u), -1.0, 1.0);
    let shadow_edge = clamp(sc(2u), 0.05, 0.9);
    let shadow_inner = shadow_edge * 0.4;
    var highlight_edge = clamp(sc(3u), 0.1, 0.98);
    highlight_edge = max(highlight_edge, shadow_edge + 0.02);

    let luma = dot(clamp(tex.rgb, vec3f(0.0), vec3f(1.0)), LUMA);

    let shadow_w = 1.0 - smoothstep(shadow_inner, shadow_edge, luma);
    let highlight_w = smoothstep(highlight_edge, 1.0, luma);

    var rgb = tex.rgb;
    rgb = rgb * (1.0 + shadows * shadow_w * 0.6) + vec3f(shadows * shadow_w * 0.28);
    rgb = rgb * (1.0 + highlights * highlight_w * 0.6) + vec3f(highlights * highlight_w * 0.12);

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
