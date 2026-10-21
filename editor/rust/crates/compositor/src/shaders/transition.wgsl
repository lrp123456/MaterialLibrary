// 双输入转场着色器。
//
// 与 blend.wgsl 的区别：
//   - blend 是"底图 + 上层图层"按 alpha 合成，属于图层栈；
//   - transition 是 from / to 两张等大画面按 progress 混合，属于帧项的一种。
//
// 约定：
//   - 所有采样坐标一律 clamp 到 [0,1]，避免越界采样出现黑边（采样器本身就是
//     ClampToEdge，这里再夹一次是为了让位移/缩放类转场在边缘是"拉伸"而不是黑框）。
//   - 噪声只用确定性 hash（种子取 UV 与 progress），不引入任何全局时间变量，
//     保证同一帧同一 progress 永远得到同一画面，导出与预览完全一致。
//   - 不在非一致控制流里调用 textureSample（naga 的导数一致性校验会拒），
//     因此所有分支都用 mix / select 写成无分支形式。

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 与 Rust 侧 TransitionUniformBuffer 逐字段对应（48 字节，16 字节对齐）
struct TransitionUniforms {
    resolution: vec2f,   // 0  画布分辨率
    progress: f32,       // 8  0..1
    mode: u32,           // 12 0..11
    scalars: vec4f,      // 16 x=softness y=amount z/w 预留
    direction: vec2f,    // 32 推移/擦除方向
    _pad: vec2f,         // 40
}

@group(0) @binding(0) var tex_from: texture_2d<f32>;
@group(0) @binding(1) var tex_to: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: TransitionUniforms;

const PI: f32 = 3.14159265358979;

fn uv_clamped(uv: vec2f) -> vec2f {
    return clamp(uv, vec2f(0.0), vec2f(1.0));
}

fn sample_from(uv: vec2f) -> vec4f {
    return textureSample(tex_from, samp, uv_clamped(uv));
}

fn sample_to(uv: vec2f) -> vec4f {
    return textureSample(tex_to, samp, uv_clamped(uv));
}

// 1 = 坐标落在画面内，0 = 落在画面外（用 step 拼出来，保持无分支）
fn coverage(v: vec2f) -> f32 {
    let lo = step(vec2f(0.0), v);
    let hi = step(v, vec2f(1.0));
    return lo.x * lo.y * hi.x * hi.y;
}

fn softness() -> f32 {
    return clamp(u.scalars.x, 0.0, 1.0);
}

fn amount() -> f32 {
    return clamp(u.scalars.y, 0.0, 1.0);
}

fn softness_min() -> f32 {
    // smoothstep 的上下界不能相等，这里给一个下限
    return max(softness(), 0.002);
}

fn direction_unit() -> vec2f {
    let d = u.direction;
    let len = length(d);
    if (len < 0.00001) {
        return vec2f(1.0, 0.0);
    }
    return d / len;
}

// 确定性 2D hash（Dave Hoskins 的经典实现），无时间、无随机数状态
fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + vec3f(dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn rotate_uv(uv: vec2f, angle: f32) -> vec2f {
    let c = cos(angle);
    let s = sin(angle);
    let p = uv - vec2f(0.5);
    return vec2f(c * p.x - s * p.y, s * p.x + c * p.y) + vec2f(0.5);
}

// 混好的一帧画面，供模糊转场反复取用
fn mixed_at(uv: vec2f, p: f32) -> vec4f {
    return mix(sample_from(uv), sample_to(uv), p);
}

// 单次 5 抽盒式（中心 + 四邻域）
fn box5(uv: vec2f, p: f32, offset: vec2f) -> vec4f {
    var sum = mixed_at(uv, p);
    sum = sum + mixed_at(uv + vec2f(offset.x, 0.0), p);
    sum = sum + mixed_at(uv - vec2f(offset.x, 0.0), p);
    sum = sum + mixed_at(uv + vec2f(0.0, offset.y), p);
    sum = sum + mixed_at(uv - vec2f(0.0, offset.y), p);
    return sum * 0.2;
}

// ---------- mode 0：叠化 ----------
fn m_dissolve(a: vec4f, b: vec4f, p: f32) -> vec4f {
    // softness 越大越接近 smoothstep 的缓入缓出，0 时是线性叠化
    let t = mix(p, smoothstep(0.0, 1.0, p), softness());
    return mix(a, b, t);
}

// ---------- mode 1 / 2：黑场 / 白场过渡 ----------
fn m_dip(a: vec4f, b: vec4f, p: f32, dip_color: vec3f) -> vec4f {
    let fill = vec4f(dip_color, 1.0);
    let fade_out = clamp(p * 2.0, 0.0, 1.0);
    let fade_in = clamp((p - 0.5) * 2.0, 0.0, 1.0);
    let first_half = mix(a, fill, fade_out);
    let second_half = mix(fill, b, fade_in);
    return mix(first_half, second_half, step(0.5, p));
}

// ---------- mode 3 / 4：推移 ----------
// d 是"画面移动方向"：左推时 d=(1,0)，上推时 d=(0,1)
fn m_push(uv: vec2f, p: f32, d: vec2f) -> vec4f {
    let uv_a = uv + d * p;
    let uv_b = uv_a - d;
    let a = sample_from(uv_a);
    let b = sample_to(uv_b);
    let ma = coverage(uv_a);
    let mb = coverage(uv_b);
    return a * ma + b * mb * (1.0 - a.a * ma);
}

// ---------- mode 5：缩放推近 ----------
fn m_zoom(uv: vec2f, p: f32) -> vec4f {
    let amt = amount();
    let zoom = 0.45 * amt;
    // A 逐渐放大（采样范围收窄），B 从略小拉回原尺寸
    let uv_a = (uv - vec2f(0.5)) * (1.0 - zoom * p) + vec2f(0.5);
    let uv_b = (uv - vec2f(0.5)) * (1.0 + zoom * 0.6 * (1.0 - p)) + vec2f(0.5);
    return mix(sample_from(uv_a), sample_to(uv_b), smoothstep(0.0, 1.0, p));
}

// ---------- mode 6：旋转 ----------
fn m_rotate(uv: vec2f, p: f32) -> vec4f {
    let amt = amount();
    // A 从 0 转到正角度、B 从负角度转回 0：窗口两端都不会跳变
    let uv_a = rotate_uv(uv, p * amt * PI * 0.35);
    let uv_b = rotate_uv(uv, -(1.0 - p) * amt * PI * 0.35);
    return mix(sample_from(uv_a), sample_to(uv_b), smoothstep(0.0, 1.0, p));
}

// ---------- mode 7：模糊过渡 ----------
fn m_blur(uv: vec2f, p: f32) -> vec4f {
    let px = vec2f(1.0, 1.0) / max(u.resolution, vec2f(1.0, 1.0));
    // 中间最糊、两端清晰
    let peak = 1.0 - abs(p * 2.0 - 1.0);
    let radius = softness() * 24.0 * peak;
    let offset_a = px * radius;
    let offset_b = px * radius * 0.5;
    // 两次盒式叠加，近似高斯；不引外部 blur 通道
    let pass_a = box5(uv, p, offset_a);
    return box5(uv, p, offset_b) * 0.25 + pass_a * 0.75;
}

// ---------- mode 8：线性擦除 ----------
fn m_wipe(uv: vec2f, p: f32) -> vec4f {
    let soft = softness_min();
    let d = direction_unit();
    let proj = dot(uv - vec2f(0.5), d) + 0.5;
    let edge = p * (1.0 + 2.0 * soft) - soft;
    let mask = 1.0 - smoothstep(edge - soft, edge + soft, proj);
    return mix(sample_from(uv), sample_to(uv), mask);
}

// ---------- mode 9：百叶窗 ----------
fn m_blinds(uv: vec2f, p: f32) -> vec4f {
    let soft = softness_min();
    let bands = mix(4.0, 24.0, amount());
    let y = uv.y * bands;
    let index = floor(y);
    let frac = y - index;
    // 每条按序号错开，避免整屏同时翻面
    let delay = (index / bands) * 0.35;
    let local = clamp((p - delay) / (1.0 - 0.35), 0.0, 1.0);
    let mask = smoothstep(local - soft, local + soft, frac);
    // frac 小于 local 的条带已经切到 B
    return mix(sample_to(uv), sample_from(uv), mask);
}

// ---------- mode 10：置换故障 ----------
fn m_glitch(uv: vec2f, p: f32) -> vec4f {
    let amt = amount();
    let rows = 48.0;
    let row = floor(uv.y * rows);
    let phase = floor(p * 12.0);
    let noise_a = hash21(vec2f(row, phase));
    let noise_b = hash21(vec2f(row * 1.7 + 3.1, phase + 7.0));
    let peak = 1.0 - abs(p * 2.0 - 1.0);
    // 只有部分行参与位移，其余保持原样
    let row_active = step(0.55, noise_b) * peak;
    let shift = (noise_a - 0.5) * 0.16 * amt * row_active;
    let uv_shift = vec2f(uv.x + shift, uv.y);
    let split = 0.015 * amt * row_active;
    let a = mixed_at(uv_shift, p);
    let red_from = sample_from(vec2f(uv_shift.x + split, uv_shift.y)).r;
    let red_to = sample_to(vec2f(uv_shift.x + split, uv_shift.y)).r;
    return vec4f(mix(red_from, red_to, p), a.g, a.b, a.a);
}

// ---------- mode 11：翻页 ----------
fn m_page(uv: vec2f, p: f32) -> vec4f {
    let soft = softness();
    let d = direction_unit();
    let proj = dot(uv - vec2f(0.5), d) + 0.5;
    // 折页前沿从 1 收到 0
    let edge = 1.0 - p;
    // 折页带宽度随进度从 0 展开：p=0 时没有带，右边缘不会出现压暗条
    let band_raw = (0.03 + soft * 0.28) * clamp(p * 6.0, 0.0, 1.0);
    let gate = step(0.0005, band_raw);
    let band = max(band_raw, 0.001);
    // 折页背面的镜像采样
    let mirrored = edge + (edge - proj);
    let uv_back = uv + d * (mirrored - proj);
    let a_front = sample_from(uv);
    let a_back = sample_from(uv_back);
    let b = sample_to(uv);
    // 越靠近折痕越暗，折痕处压一条高光；gate=0 时不做任何明暗处理
    let fold_t = clamp((edge - proj) / band, 0.0, 1.0);
    let depth = mix(1.0, fold_t, gate);
    let shade = mix(0.5, 1.0, depth);
    let highlight = 1.0 + 0.35 * (1.0 - abs(depth * 2.0 - 1.0));
    let a_shaded = vec4f(
        clamp(a_front.rgb * mix(0.72, 1.0, depth), vec3f(0.0), vec3f(1.0)),
        a_front.a,
    );
    let folded = vec4f(
        clamp(a_back.rgb * shade * highlight, vec3f(0.0), vec3f(1.0)),
        a_back.a,
    );
    let in_band = step(edge - band, proj) * step(proj, edge) * gate;
    let front = mix(a_shaded, folded, in_band);
    return select(front, b, proj > edge);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let uv = input.tex_coord;
    let p = clamp(u.progress, 0.0, 1.0);
    let a = sample_from(uv);
    let b = sample_to(uv);

    // switch 的选择子是 uniform，控制流一致，可以在分支里采样
    var result = m_dissolve(a, b, p);
    switch u.mode {
        case 1u: { result = m_dip(a, b, p, vec3f(0.0, 0.0, 0.0)); }
        case 2u: { result = m_dip(a, b, p, vec3f(1.0, 1.0, 1.0)); }
        case 3u: { result = m_push(uv, p, direction_unit()); }
        case 4u: { result = m_push(uv, p, vec2f(0.0, 1.0)); }
        case 5u: { result = m_zoom(uv, p); }
        case 6u: { result = m_rotate(uv, p); }
        case 7u: { result = m_blur(uv, p); }
        case 8u: { result = m_wipe(uv, p); }
        case 9u: { result = m_blinds(uv, p); }
        case 10u: { result = m_glitch(uv, p); }
        case 11u: { result = m_page(uv, p); }
        default: { result = m_dissolve(a, b, p); }
    }

    // alpha 与 rgb 一起夹紧，避免混合后越界导致后面 blend 通道出现负色
    return clamp(result, vec4f(0.0), vec4f(1.0));
}
