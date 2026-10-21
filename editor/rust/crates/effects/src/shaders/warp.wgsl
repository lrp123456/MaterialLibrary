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

// 几何变形：先算采样 UV，再取样。无时间变量，转场时由外部传 phase 驱动，保证无状态。
// scalars.x = amount 强度(0..1)
// scalars.y = scale  空间频率/半径(1..64)
// scalars.z = phase  相位(0..2π)
// scalars.w = mode   0=wave 1=turbulent 2=twirl 3=spherize 4=mirror 5=magnify 6=grid

// 确定性 hash（不用时间，保证同一帧同一输入永远同一结果）
fn hash21(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amount = clamp(uniforms.scalars.x, 0.0, 1.0);
    let scale = clamp(uniforms.scalars.y, 1.0, 64.0);
    let phase = uniforms.scalars.z;
    let mode = i32(round(clamp(uniforms.scalars.w, 0.0, 6.0)));

    let aspect = max(uniforms.resolution.x, 1.0) / max(uniforms.resolution.y, 1.0);

    // 以画面中心为原点，x 做长宽比校正，避免变形被拉伸
    var p = (input.tex_coord - vec2f(0.5)) * vec2f(aspect, 1.0);

    if (mode == 0) {
        // wave：横向正弦位移，沿 y 方向推进
        let amp = amount * 0.06;
        p.x = p.x + amp * sin(p.y * scale * 6.2831853 + phase);
    } else if (mode == 1) {
        // turbulent：格点 hash 噪声扰动（相位平移格点，产生可驱动的时间感）
        let q = p * scale;
        let n1 = hash21(floor(q) + vec2f(phase, 0.0));
        let n2 = hash21(floor(q) + vec2f(phase * 1.7, 11.3) + vec2f(37.1, 17.9));
        p = p + (vec2f(n1, n2) - vec2f(0.5)) * amount * 0.1;
    } else if (mode == 2) {
        // twirl：绕中心旋转，越靠中心转得越多
        let falloff = 1.0 - smoothstep(0.0, 0.65, length(p));
        let angle = amount * 3.14159265 * falloff;
        let cs = cos(angle);
        let sn = sin(angle);
        p = vec2f(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    } else if (mode == 3) {
        // spherize：中心放大并向边缘过渡，形成球面感
        let falloff = 1.0 - smoothstep(0.0, 0.5, length(p));
        p = p * (1.0 - amount * 0.5 * falloff);
    } else if (mode == 4) {
        // mirror：右半镜像到左半
        if (p.x > 0.0) {
            p.x = mix(p.x, -p.x, amount);
        }
    } else if (mode == 5) {
        // magnify：整体放大，amount 越大倍率越高
        p = p * (1.0 / (1.0 + amount * 2.0));
    } else {
        // grid：按网格随机偏移，块状错位
        let cell = floor(input.tex_coord * scale);
        let jitter = vec2f(
            hash21(cell) - 0.5,
            hash21(cell + vec2f(19.7, 7.3)) - 0.5
        );
        p = p + jitter * amount * (2.0 / max(scale, 1.0));
    }

    // 回到 uv 空间，越界 clamp 到边缘，避免黑边
    let uv = clamp(p / vec2f(aspect, 1.0) + vec2f(0.5), vec2f(0.0), vec2f(1.0));
    let tex = textureSample(input_texture, input_sampler, uv);
    return vec4f(tex.rgb, tex.a);
}
