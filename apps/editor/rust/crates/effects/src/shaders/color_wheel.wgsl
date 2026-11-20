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

// 三色轮（lift / gamma / gain）：达芬奇与剪映"色轮"页的最小可用等价物。
// 三段各司其职 —— gain 是亮端的乘性增益，lift 是暗端的加性偏移，
// gamma 是以 0.18 为枢轴的指数变换，只动中间调；三者叠起来才能把一段素材推成另一种影调。
// scalars[0..2]  = lift  R/G/B   -1..1
// scalars[3..5]  = gamma R/G/B   -1..1
// scalars[6..8]  = gain  R/G/B   -1..1
// scalars[9]     = 强度 0..1（默认 1）
const PIVOT = 0.18;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);
    let strength = clamp(sc(9u), 0.0, 1.0);

    let lift = clamp(vec3f(sc(0u), sc(1u), sc(2u)), vec3f(-1.0), vec3f(1.0));
    let gamma = clamp(vec3f(sc(3u), sc(4u), sc(5u)), vec3f(-0.9), vec3f(0.9));
    let gain = clamp(vec3f(sc(6u), sc(7u), sc(8u)), vec3f(-1.0), vec3f(1.0));

    var rgb = tex.rgb;

    // 1) gain：整段乘性，主要作用在亮端
    rgb = rgb * (vec3f(1.0) + gain * 0.8);

    // 2) lift：加性，但按"离白的距离"衰减，避免把高光顶爆
    rgb = rgb + lift * 0.35 * (vec3f(1.0) - clamp(rgb, vec3f(0.0), vec3f(1.0)));

    // 3) gamma：保住枢轴亮度，只把曲线弯一弯
    let exponent = vec3f(1.0) / (vec3f(1.0) + gamma * 0.9);
    rgb = vec3f(PIVOT) * pow(max(rgb, vec3f(0.0)) / vec3f(PIVOT), exponent);

    rgb = mix(tex.rgb, rgb, strength);
    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
