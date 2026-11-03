"""
EdgeSAM PyTorch → TorchScript → PNNX → NCNN
（对齐博客方法：比 ONNX 中转更稳）

用法（需 torch）:
  python scripts/convert_edgesam_pnnx.py \
    --pth data/local-models/edge_sam.pth \
    --outdir data/local-models \
    --pnnx tools/pnnx/pnnx.exe

输出:
  edge_sam_encoder.ncnn.param / .bin
  edge_sam_decoder.ncnn.param / .bin
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path


def export_torchscript(pth_path: Path, outdir: Path):
    import torch

    # EdgeSAM / SAM 编码器输入: NCHW 1x3x1024x1024
    # 解码器: image_embeddings + point_coords + point_labels + mask_input + has_mask_input + orig_im_size
    sd = torch.load(str(pth_path), map_location="cpu")
    if isinstance(sd, dict) and "model" in sd:
        sd = sd["model"]

    # 权重是完整 SAM state_dict 时，用 segment_anything 官方结构加载；
    # 若无仓库，退化为仅导出「壳」失败并提示用 ONNX。
    try:
        from segment_anything import sam_model_registry
        from segment_anything.modeling import Sam
    except ImportError:
        print("[warn] 未安装 segment_anything，尝试直接用官方 EdgeSAM 仓库结构")
        sam = None
    else:
        sam = sam_model_registry["vit_t"](checkpoint=None)
        missing, unexpected = sam.load_state_dict(sd, strict=False)
        print(f"[load] missing={len(missing)} unexpected={len(unexpected)}")
        sam.eval()

    enc_path = outdir / "edge_sam_encoder.ts.pt"
    dec_path = outdir / "edge_sam_decoder.ts.pt"

    if sam is not None:
        class Enc(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, x):
                return self.m.image_encoder(x)

        class Dec(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, image_embeddings, point_coords, point_labels, mask_input, has_mask_input, orig_im_size):
                sparse, dense = self.m.prompt_encoder(
                    points=(point_coords, point_labels),
                    boxes=None,
                    masks=None if has_mask_input.sum() < 0.5 else mask_input,
                )
                low_res, _ = self.m.mask_decoder(
                    image_embeddings=image_embeddings,
                    image_pe=self.m.prompt_encoder.get_dense_pe(),
                    sparse_prompt_embeddings=sparse,
                    dense_prompt_embeddings=dense,
                    multimask_output=False,
                )
                return low_res

        enc = Enc(sam).eval()
        dec = Dec(sam).eval()
        img = torch.randn(1, 3, 1024, 1024)
        pts = torch.tensor([[[512.0, 512.0]]])
        labels = torch.tensor([[1]])
        mask_in = torch.zeros(1, 1, 256, 256)
        has_mask = torch.zeros(1)
        size = torch.tensor([1024.0, 1024.0])

        with torch.no_grad():
            ts_enc = torch.jit.trace(enc, img)
            ts_dec = torch.jit.trace(dec, (
                torch.randn(1, 256, 64, 64), pts, labels, mask_in, has_mask, size
            ))
        ts_enc.save(str(enc_path))
        ts_dec.save(str(dec_path))
        print(f"[ok] saved {enc_path} {dec_path}")
        return enc_path, dec_path

    raise RuntimeError(
        "请安装 segment_anything 或 EdgeSAM 仓库后再跑 PNNX；"
        "当前已有 onnx2ncnn 产物 edge_sam_encoder/decoder.param|bin 可先用"
    )


def run_pnnx(pnnx: str, ts_path: Path, inputshapes: list):
    cmd = [pnnx, str(ts_path)] + inputshapes
    print("[pnnx]", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ts_path.parent))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pth", default="data/local-models/edge_sam.pth")
    ap.add_argument("--outdir", default="data/local-models")
    ap.add_argument("--pnnx", default="")
    ap.add_argument("--skip-export", action="store_true", help="已有 ts.pt 时跳过")
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    pth = Path(args.pth)

    if not args.skip_export:
        export_torchscript(pth, outdir)

    if args.pnnx and Path(args.pnnx).exists():
        run_pnnx(args.pnnx, outdir / "edge_sam_encoder.ts.pt", [
            "inputshape=[1,3,1024,1024]f32",
        ])
        run_pnnx(args.pnnx, outdir / "edge_sam_decoder.ts.pt", [
            "inputshape=[1,256,64,64]f32",
            "inputshape2=[1,1,2]f32",
            "inputshape3=[1,1]i64",
            "inputshape4=[1,1,256,256]f32",
            "inputshape5=[1]f32",
            "inputshape6=[2]f32",
        ])
        print("[done] 查看目录下 *.ncnn.param / *.ncnn.bin")
    else:
        print("[skip] 未提供 pnnx.exe；请到 https://github.com/pnnx/pnnx/releases 下载")


if __name__ == "__main__":
    main()
