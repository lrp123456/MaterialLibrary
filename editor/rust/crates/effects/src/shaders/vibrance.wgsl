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

// 自然饱和度（Vibrance）：只补"没饱和"的像素，已经浓的地方不再加，
// 和 grade 的线性饱和度区别就在这里 —— 人脸/口红不会一拉就炸成橘红。
// scalars[0] = 自然饱和度 -1..1
// scalars[1] = 全局饱和度 -1..1（叠加在线性饱和度上，默认 0）
// scalars[2] = 肤色保护 0..1（削弱落在肤色色相区间上的增益）
const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn hue_of(c: vec3f) -> f32 {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let d = mx - mn;
    if (d < 1e-6) {
        return 0.0;
    }
    var h = 0.0;
    if (mx == c.r) {
        h = (c.g - c.b) / d;
    } else if (mx == c.g) {
        h = 2.0 + (c.b - c.r) / d;
    } else {
        h = 4.0 + (c.r - c.g) / d;
    }
    h = h * 60.0;
    if (h < 0.0) {
        h = h + 360.0;
    }
    return h;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);
    let vib = clamp(sc(0u), -1.0, 1.0);
    let global_sat = clamp(sc(1u), -1.0, 1.0);
    let protect = clamp(sc(2u), 0.0, 1.0);

    let rgb = tex.rgb;
    let mx = max(rgb.r, max(rgb.g, rgb.b));
    let mn = min(rgb.r, min(rgb.g, rgb.b));
    // 用 max 归一的饱和度量：暗部不因除以亮度而虚高
    let sat = (mx - mn) / max(mx, 1e-4);
    let luma = dot(rgb, LUMA);

    // 越不饱和补得越多；往负方向走时反过来，先卸掉最浓的地方
    var amount = select(1.0 - sat, sat, vib < 0.0);
    amount = amount * vib;

    if (protect > 0.0) {
        let h = hue_of(rgb);
        // 肤色大致落在 8..52 度：上升沿 8→26，下降沿 40→58，两端各自羽化
        let in_skin = smoothstep(8.0, 26.0, h) * (1.0 - smoothstep(40.0, 58.0, h));
        let skin = clamp(in_skin, 0.0, 1.0) * smoothstep(0.05, 0.2, sat);
        amount = amount * (1.0 - protect * skin);
    }

    let out_rgb = mix(vec3f(luma), rgb, 1.0 + amount + global_sat);
    return vec4f(clamp(out_rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
