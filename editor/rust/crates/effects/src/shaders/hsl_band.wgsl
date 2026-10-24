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

// HSL 分色：只动一段色相，其余保持不变（剪映/达芬奇的"颜色分级"页本质就是它）。
// 一个 band 只处理一段色相，八段就是八个 pass 串联 —— 单 pass 塞八段反而要更多 uniform。
// scalars[0] = 中心色相 0..360
// scalars[1] = 色相半宽 1..180（覆盖到相邻色相就取 60）
// scalars[2] = 羽化 0..1（1 = 全渐变过渡，0 = 硬边）
// scalars[3] = 色相偏移 -180..180
// scalars[4] = 饱和度 -1..1
// scalars[5] = 明亮度 -1..1
// scalars[6] = 强度 0..1（默认 1，用来做"效果混入比例"）

fn rgb_to_hsl(c: vec3f) -> vec3f {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let d = mx - mn;
    let l = (mx + mn) * 0.5;
    if (d < 1e-6) {
        return vec3f(0.0, 0.0, l);
    }
    var s = d / (mx + mn);
    if (l >= 0.5) {
        s = d / (2.0 - mx - mn);
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
    return vec3f(h, s, l);
}

fn hue_channel(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) {
        t = t + 1.0;
    }
    if (t > 1.0) {
        t = t - 1.0;
    }
    if (t < 0.1666667) {
        return mix(p, q, 6.0 * t);
    }
    if (t < 0.5) {
        return q;
    }
    if (t < 0.6666667) {
        return mix(p, q, (0.6666667 - t) * 6.0);
    }
    return p;
}

fn hsl_to_rgb(hsl: vec3f) -> vec3f {
    let s = clamp(hsl.y, 0.0, 1.0);
    let l = clamp(hsl.z, 0.0, 1.0);
    if (s < 1e-6) {
        return vec3f(l);
    }
    var q = l * (1.0 + s);
    if (l >= 0.5) {
        q = l + s - l * s;
    }
    let p = 2.0 * l - q;
    let h = hsl.x / 360.0;
    return vec3f(
        hue_channel(p, q, h + 0.3333333),
        hue_channel(p, q, h),
        hue_channel(p, q, h - 0.3333333),
    );
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);

    let center = sc(0u);
    let half_width = max(sc(1u), 1.0);
    let feather = clamp(sc(2u), 0.0, 1.0);
    let hue_shift = clamp(sc(3u), -180.0, 180.0);
    let sat_adj = clamp(sc(4u), -1.0, 1.0);
    let light_adj = clamp(sc(5u), -1.0, 1.0);
    let strength = clamp(sc(6u), 0.0, 1.0);

    var hsl = rgb_to_hsl(tex.rgb);

    // 色相是环形的，距离要取两个方向上的较小值
    var dist = abs(hsl.x - center);
    dist = min(dist, 360.0 - dist);

    let inner = half_width * (1.0 - feather);
    // smoothstep 要求 edge0 < edge1，feather=0 时两者相等会除零，所以留 0.5 度的硬边过渡
    let outer = max(half_width, inner + 0.5);
    // 灰像素的色相是噪声，饱和度门槛让它别被误伤
    let band = 1.0 - smoothstep(inner, outer, dist);
    let w = band * smoothstep(0.02, 0.09, hsl.y) * strength;

    hsl.x = hsl.x + hue_shift * w;
    hsl.x = fract(hsl.x / 360.0) * 360.0;

    hsl.y = clamp(hsl.y * (1.0 + sat_adj * w), 0.0, 1.0);

    // 明亮度用"向两端压缩"的非线性映射，避免提亮直接把人脸打白
    let up = light_adj * w;
    if (up >= 0.0) {
        hsl.z = hsl.z + (1.0 - hsl.z) * up;
    } else {
        hsl.z = hsl.z * (1.0 + up);
    }

    let out_rgb = hsl_to_rgb(hsl);
    return vec4f(clamp(out_rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
