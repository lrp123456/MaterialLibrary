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

// 色彩克隆：Reinhard 统计迁移，只是把线性 RGB 换成感知均匀的 Lab。
// 参考帧与目标帧的均值/方差在 CPU（2D canvas 抽帧）算完，这里只收 6 个仿射参数：
//   out_lab = (in_lab - src_mean) * (ref_std / src_std) + ref_mean
// 展开成 scale/shift 后 shader 就不需要知道两边的统计量了。
// scalars[0..2] = scale L/a/b
// scalars[3..5] = shift L/a/b
// scalars[6]    = mode 0=整体 1=仅色彩(保住原亮度) 2=仅亮度(保住原色度)
// scalars[7]    = 强度 0..1
const WHITE = vec3f(0.95047, 1.0, 1.08883);
const LAB_EPS = 0.008856451679035635;
const LAB_KAPPA = 903.2962962962963;

fn srgb_to_linear(c: vec3f) -> vec3f {
    let lo = c / 12.92;
    let hi = pow((c + vec3f(0.055)) / vec3f(1.055), vec3f(2.4));
    return select(lo, hi, c > vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
    let lo = c * 12.92;
    let hi = vec3f(1.055) * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
    return select(lo, hi, c > vec3f(0.0031308));
}

fn lab_f(t: f32) -> f32 {
    if (t > LAB_EPS) {
        // cbrt 对负数要有定义（a/b 通道会负），pow 不行，所以带符号取立方根
        return sign(t) * pow(abs(t), 1.0 / 3.0);
    }
    return (LAB_KAPPA * t + 16.0) / 116.0;
}

fn lab_f_inv(fv: f32) -> f32 {
    let cubed = fv * fv * fv;
    if (cubed > LAB_EPS) {
        return cubed;
    }
    return (116.0 * fv - 16.0) / LAB_KAPPA;
}

fn rgb_to_lab(rgb: vec3f) -> vec3f {
    let lin = srgb_to_linear(rgb);
    let xyz = vec3f(
        dot(lin, vec3f(0.4124564, 0.3575761, 0.1804375)),
        dot(lin, vec3f(0.2126729, 0.7151522, 0.072175)),
        dot(lin, vec3f(0.0193339, 0.119192, 0.9503041)),
    ) / WHITE;
    let fx = lab_f(xyz.x);
    let fy = lab_f(xyz.y);
    let fz = lab_f(xyz.z);
    return vec3f(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

fn lab_to_rgb(lab: vec3f) -> vec3f {
    let fy = (lab.x + 16.0) / 116.0;
    let fx = fy + lab.y / 500.0;
    let fz = fy - lab.z / 200.0;
    let xyz = vec3f(lab_f_inv(fx), lab_f_inv(fy), lab_f_inv(fz)) * WHITE;
    let lin = vec3f(
        dot(xyz, vec3f(3.2404542, -1.5371385, -0.4985314)),
        dot(xyz, vec3f(-0.969266, 1.8760108, 0.041556)),
        dot(xyz, vec3f(0.0556434, -0.2040259, 1.0572252)),
    );
    return clamp(linear_to_srgb(lin), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);
    let src = clamp(tex.rgb, vec3f(0.0), vec3f(1.0));

    let scale = vec3f(sc(0u), sc(1u), sc(2u));
    let shift = vec3f(sc(3u), sc(4u), sc(5u));
    let mode = i32(round(clamp(sc(6u), 0.0, 2.0)));
    let strength = clamp(sc(7u), 0.0, 1.0);

    var lab = rgb_to_lab(src);
    let mapped = lab * scale + shift;

    // L 是 0..100、a/b 大致 -128..127，混在一起钳位会误伤，所以分通道钳
    var out_lab = lab;
    if (mode == 0) {
        out_lab = mapped;
    } else if (mode == 1) {
        out_lab = vec3f(lab.x, mapped.y, mapped.z);
    } else {
        out_lab = vec3f(mapped.x, lab.y, lab.z);
    }
    out_lab = vec3f(clamp(out_lab.x, 0.0, 100.0), clamp(out_lab.y, -128.0, 127.0), clamp(out_lab.z, -128.0, 127.0));

    let out_rgb = mix(src, lab_to_rgb(out_lab), strength);
    return vec4f(clamp(out_rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
