#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地语音识别服务（FunASR 系模型 · sherpa-onnx 推理后端）

为什么不是直接 pip install funasr：
  FunASR 官方包在 Windows + Python 3.13 上要编译 numpy/kaldi-native-fbank，
  且依赖 torchaudio（会和本机已装的 torch 抢版本）。sherpa-onnx 是同一批
  FunASR/Paraformer/SenseVoice 权重的 C++/ONNX 推理后端，单 wheel、无 torch，
  CPU 上对 3~10 秒短句延迟约 0.2~0.5 秒，适合「按住说话」这种交互。

提供两种入口：
  HTTP  127.0.0.1:10095  GET /health   POST /transcribe   （一次性整段识别）
  WS    127.0.0.1:10096  二进制 PCM16 16k 单声道 + JSON 控制帧（边录边出字）

WS 协议：
  → {"type":"start"}        开始一段
  → <binary>                16k / 16bit / 单声道 小端 PCM，任意长度
  → {"type":"end"}          结束，返回 final
  ← {"type":"ready"}
  ← {"type":"partial","text":"..."}   未提交片段的实时预览
  ← {"type":"commit","text":"...","full":"..."}  检测到停顿，提交一句
  ← {"type":"final","text":"..."}     整段最终结果
  ← {"type":"error","message":"..."}

运行：
  python scripts/asr/asr_server.py
  # 可选环境变量：ASR_HTTP_PORT / ASR_WS_PORT / ASR_MODEL_DIR / ASR_THREADS
"""
import asyncio
import json
import os
import re
import sys
import time
import wave
import io
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

DEFAULT_MODEL_DIR = os.path.join(
    os.path.expanduser("~"),
    ".dsh-material-library", "models", "asr",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
)
MODEL_DIR = os.environ.get("ASR_MODEL_DIR", DEFAULT_MODEL_DIR)
HTTP_PORT = int(os.environ.get("ASR_HTTP_PORT", "10095"))
WS_PORT = int(os.environ.get("ASR_WS_PORT", "10096"))
THREADS = int(os.environ.get("ASR_THREADS", "2"))
SAMPLE_RATE = 16000

TAG_RE = re.compile(r"<\|[^|]*\|>")
_recognizer = None
_model_load_ms = 0
_lock = threading.Lock()


def clean_text(s: str) -> str:
    s = TAG_RE.sub("", s or "")
    return re.sub(r"\s+", " ", s).strip()


def get_recognizer():
    global _recognizer, _model_load_ms
    if _recognizer is not None:
        return _recognizer
    with _lock:
        if _recognizer is not None:
            return _recognizer
        import sherpa_onnx

        model = os.path.join(MODEL_DIR, "model.int8.onnx")
        if not os.path.exists(model):
            model = os.path.join(MODEL_DIR, "model.onnx")
        tokens = os.path.join(MODEL_DIR, "tokens.txt")
        if not (os.path.exists(model) and os.path.exists(tokens)):
            raise RuntimeError(f"模型文件缺失：{MODEL_DIR}（需要 model.int8.onnx 与 tokens.txt）")
        t0 = time.time()
        _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model,
            tokens=tokens,
            num_threads=THREADS,
            use_itn=True,
            language="auto",
            debug=False,
        )
        _model_load_ms = int((time.time() - t0) * 1000)
        print(f"[asr] 模型已加载 {MODEL_DIR}（{_model_load_ms}ms，threads={THREADS}）", flush=True)
        return _recognizer


def transcribe(samples: np.ndarray):
    """samples: float32 [-1,1]，16k 单声道。返回 (文本, 耗时ms)"""
    if samples is None or len(samples) < int(0.15 * SAMPLE_RATE):
        return "", 0
    rec = get_recognizer()
    t0 = time.time()
    stream = rec.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    rec.decode_stream(stream)
    text = clean_text(stream.result.text)
    return text, int((time.time() - t0) * 1000)


def pcm16_to_float(buf: bytes) -> np.ndarray:
    if not buf:
        return np.zeros(0, dtype=np.float32)
    a = np.frombuffer(buf, dtype=np.int16).astype(np.float32)
    return a / 32768.0


def wav_to_float(buf: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(buf), "rb") as w:
        ch, sr, width = w.getnchannels(), w.getframerate(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError("仅支持 16bit WAV")
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    if sr != SAMPLE_RATE:
        n = int(len(data) * SAMPLE_RATE / sr)
        idx = np.linspace(0, len(data) - 1, n).astype(np.float64)
        data = np.interp(idx, np.arange(len(data)), data).astype(np.float32)
    return data


# ---------------------------- HTTP ----------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health") or self.path == "/":
            ready = os.path.exists(os.path.join(MODEL_DIR, "tokens.txt"))
            return self._json(200, {
                "ok": True,
                "engine": "sherpa-onnx/sense-voice",
                "model": os.path.basename(MODEL_DIR),
                "loaded": _recognizer is not None,
                "loadMs": _model_load_ms,
                "sampleRate": SAMPLE_RATE,
                "ready": ready,
            })
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/transcribe"):
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._json(400, {"error": "空请求体"})
        if length > 30 * 1024 * 1024:
            return self._json(413, {"error": "音频超过 30MB"})
        raw = self.rfile.read(length)
        try:
            if raw[:4] == b"RIFF":
                samples = wav_to_float(raw)
            else:
                samples = pcm16_to_float(raw)
            text, ms = transcribe(samples)
            return self._json(200, {
                "text": text,
                "elapsedMs": ms,
                "durationMs": int(len(samples) * 1000 / SAMPLE_RATE),
            })
        except Exception as e:
            return self._json(500, {"error": str(e)})


def start_http():
    srv = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    print(f"[asr] HTTP 就绪 http://127.0.0.1:{HTTP_PORT}", flush=True)
    srv.serve_forever()


# ---------------------------- WebSocket ----------------------------

class Session:
    def __init__(self, ws):
        self.ws = ws
        self.buf = np.zeros(0, dtype=np.float32)
        self.committed = ""
        self.voice_samples = 0
        self.last_voice_at = time.time()
        self.last_partial_at = 0.0
        self.lock = asyncio.Lock()
        self.closed = False
        self.denoise_rms = 0.006  # 经验阈值：-44dBFS 以下视作静音

    def append(self, samples: np.ndarray):
        if samples.size == 0:
            return
        self.buf = np.concatenate([self.buf, samples])
        frame = samples[: len(samples) - len(samples) % 480] if len(samples) >= 480 else samples
        if frame.size:
            rms = float(np.sqrt(np.mean(np.square(frame))))
            if rms > self.denoise_rms:
                self.last_voice_at = time.time()
                self.voice_samples += frame.size

    def should_commit(self) -> bool:
        silence = time.time() - self.last_voice_at
        return (
            self.buf.size > int(0.45 * SAMPLE_RATE)
            and self.voice_samples > int(0.35 * SAMPLE_RATE)
            and silence > 0.55
        )

    async def flush(self, final: bool):
        """把当前缓冲区解码出来。final=True 时必须等锁，保证松手后一定收尾。"""
        if final:
            await self.lock.acquire()
        else:
            if self.lock.locked():
                return
            await self.lock.acquire()
        try:
            if self.buf.size == 0:
                if final:
                    await self.ws.send(json.dumps(
                        {"type": "final", "text": self.committed.strip(), "elapsedMs": 0},
                        ensure_ascii=False,
                    ))
                return
            chunk = self.buf
            self.buf = np.zeros(0, dtype=np.float32)
            try:
                text, ms = await asyncio.to_thread(transcribe, chunk)
            except Exception as e:
                await self.ws.send(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))
                return
            if final:
                full = f"{self.committed}{text}".strip()
                self.committed = ""
                self.voice_samples = 0
                await self.ws.send(json.dumps(
                    {"type": "final", "text": full, "elapsedMs": ms},
                    ensure_ascii=False,
                ))
                return
            if not text:
                return
            self.voice_samples = 0
            self.committed = f"{self.committed}{text}".strip()
            await self.ws.send(json.dumps({
                "type": "commit", "text": text, "full": self.committed, "elapsedMs": ms,
            }, ensure_ascii=False))
        finally:
            self.lock.release()


async def ws_handler(ws):
    sess = Session(ws)
    await ws.send(json.dumps({"type": "ready", "engine": "sense-voice"}, ensure_ascii=False))

    try:
        async for message in ws:
            if isinstance(message, (bytes, bytearray)):
                sess.append(pcm16_to_float(bytes(message)))
                if sess.should_commit():
                    await sess.flush(final=False)
                elif sess.buf.size > int(0.9 * SAMPLE_RATE) and not sess.lock.locked():
                    now = time.time()
                    if now - sess.last_partial_at > 1.1:
                        sess.last_partial_at = now
                        snap = sess.buf
                        try:
                            txt, _ = await asyncio.to_thread(transcribe, snap)
                        except Exception:
                            txt = ""
                        if txt:
                            await ws.send(json.dumps({"type": "partial", "text": txt}, ensure_ascii=False))
                continue

            try:
                msg = json.loads(message)
            except Exception:
                continue
            t = msg.get("type")
            if t == "start":
                sess.buf = np.zeros(0, dtype=np.float32)
                sess.committed = ""
                sess.voice_samples = 0
                sess.last_voice_at = time.time()
            elif t == "flush":
                await sess.flush(final=False)
            elif t == "end":
                await sess.flush(final=True)
                await ws.send(json.dumps({"type": "done"}, ensure_ascii=False))
            elif t == "ping":
                await ws.send(json.dumps({"type": "pong"}, ensure_ascii=False))
    except Exception as e:
        print(f"[asr] ws 连接异常: {e}", flush=True)
    finally:
        sess.closed = True


async def start_ws():
    from websockets.asyncio.server import serve

    async with serve(ws_handler, "0.0.0.0", WS_PORT, max_size=8 * 1024 * 1024):
        print(f"[asr] WebSocket 就绪 ws://127.0.0.1:{WS_PORT}", flush=True)
        await asyncio.Future()


def main():
    print(f"[asr] 模型目录 {MODEL_DIR}", flush=True)
    if not os.path.exists(os.path.join(MODEL_DIR, "tokens.txt")):
        print("[asr] 警告：模型目录缺少 tokens.txt，首次识别会失败", file=sys.stderr, flush=True)
    else:
        try:
            get_recognizer()  # 预热，避免第一句话等 2 秒
        except Exception as e:
            print(f"[asr] 预热失败：{e}", file=sys.stderr, flush=True)
    threading.Thread(target=start_http, daemon=True).start()
    asyncio.run(start_ws())


if __name__ == "__main__":
    main()
