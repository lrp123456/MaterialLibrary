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

// 曲线：把一条 1D LUT 塞进 uniform 表，shader 只做线性插值。
// 为什么不传控制点？ —— 控制点要在 WGSL 里做单调三次插值（Fritsch-Carlson），
// 循环 + 除零边界一堆；JS 侧算好密集采样表中转成本几乎为零，插值结果也不会有阶梯。
// scalars[0] = mode 0=RGB(三通道同表) 1=R 2=G 3=B 4=亮度
// scalars[1] = n 采样点数（2..61）
// scalars[2 .. 2+n-1] = 曲线表，横轴等分 0..1，纵轴 0..1
const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn lut_at(x: f32, n: u32) -> f32 {
    let last = f32(n - 1u);
    let t = clamp(x, 0.0, 1.0) * last;
    let i = u32(floor(t));
    let frac = t - f32(i);
    let a = sc(2u + i);
    let b = sc(2u + min(i + 1u, n - 1u));
    return mix(a, b, frac);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let tex = textureSample(input_texture, input_sampler, input.tex_coord);

    let mode = i32(round(clamp(sc(0u), 0.0, 4.0)));
    let n = u32(clamp(sc(1u), 2.0, 61.0));

    var rgb = clamp(tex.rgb, vec3f(0.0), vec3f(1.0));

    if (mode == 0) {
        rgb = vec3f(lut_at(rgb.r, n), lut_at(rgb.g, n), lut_at(rgb.b, n));
    } else if (mode == 1) {
        rgb.r = lut_at(rgb.r, n);
    } else if (mode == 2) {
        rgb.g = lut_at(rgb.g, n);
    } else if (mode == 3) {
        rgb.b = lut_at(rgb.b, n);
    } else {
        // 亮度曲线：整体加减差值，保住原有色相不被三通道不等量扭曲
        let l = dot(rgb, LUMA);
        rgb = rgb + vec3f(lut_at(l, n) - l);
    }

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), tex.a);
}
