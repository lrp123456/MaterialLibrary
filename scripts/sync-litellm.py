#!/usr/bin/env python3
"""
从 LiteLLM 容器或服务中解析所有大模型与底层平台真实 Key，
并安全同步至 Material Library 的 SQLite 数据库 (llm_providers & llm_models)。
"""
import sys
import os
import json
import sqlite3
import subprocess

DATA_DIR = os.environ.get("ML_DATA_DIR", os.path.expanduser("~/.dsh-material-library"))
DB_PATH = os.path.join(DATA_DIR, "material.db")
ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
ENV_FOR = {
    "volcengine": "ARK_API_KEY",
    "agnes": "AGNES_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "kilo": "KILO_API_KEY",
    "modelscope": "MODELSCOPE_API_KEY",
    "litellm": "LITELLM_API_KEY",
}

def remember_env_key(name, value):
    """空着的环境变量才写入 .env。不打印钥匙，也不覆盖已有值。"""
    value = (value or "").strip()
    if not name or not value or os.environ.get(name, "").strip():
        return
    lines = []
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    found = False
    out = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(name + "="):
            current = stripped.split("=", 1)[1].strip().strip('"').strip("'")
            if current:
                return
            out.append(f"{name}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{name}={value}")
    with open(ENV_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out).rstrip() + "\n")
    try:
        os.chmod(ENV_PATH, 0o600)
    except OSError:
        pass
    os.environ[name] = value

def decrypt_from_docker():
    """通过 sm-litellm 容器运行内部解密逻辑获取真实配置"""
    py_code = """
import os, json, asyncio
from prisma import Prisma
from litellm.proxy.common_utils.encrypt_decrypt_utils import decrypt_value_helper

async def run():
    p = Prisma()
    await p.connect()
    rows = await p.litellm_proxymodeltable.find_many()
    results = []
    for r in rows:
        name = r.model_name
        params = r.litellm_params
        if isinstance(params, str):
            params = json.loads(params)
        dec = {}
        for k, v in params.items():
            if isinstance(v, str):
                d = decrypt_value_helper(value=v, key=k, exception_type='debug', return_original_value=False)
                dec[k] = d if d is not None else v
            else:
                dec[k] = v
        results.append({
            'model_name': name,
            'real_model': dec.get('model'),
            'provider': dec.get('custom_llm_provider') or dec.get('litellm_provider') or 'openai',
            'api_base': dec.get('api_base'),
            'api_key': dec.get('api_key'),
            'tpm': dec.get('tpm'),
            'rpm': dec.get('rpm')
        })
    await p.disconnect()
    print('__JSON_START__' + json.dumps(results) + '__JSON_END__')

asyncio.run(run())
"""
    try:
        salt = os.environ.get("LITELLM_SALT_KEY", "")
        res = subprocess.run(
            ["docker", "exec", "-e", f"LITELLM_SALT_KEY={salt}", "sm-litellm", "/app/.venv/bin/python3", "-c", py_code],
            capture_output=True, text=True, timeout=15
        )
        out = res.stdout
        if "__JSON_START__" in out and "__JSON_END__" in out:
            raw = out.split("__JSON_START__")[1].split("__JSON_END__")[0]
            return json.loads(raw)
    except Exception as e:
        print(f"[sync-litellm] Docker decrypt error: {e}", file=sys.stderr)
    return None

def sync_to_sqlite(models_data):
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}", file=sys.stderr)
        return False

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now = int(subprocess.check_output(["date", "+%s"]).decode().strip()) * 1000

    # 1. 确保基础供应商存在
    providers_seed = [
        ('litellm', 'LiteLLM 本地网关 (端口 4000)', 'openai', 'http://127.0.0.1:4000', '', '{}', '{"description":"本地高可用网关"}', 1),
        ('volcengine', '火山引擎 (豆包大模型)', 'volcengine', 'https://ark.cn-beijing.volces.com/api/v3', '', '{}', '{"description":"字节跳动豆包视觉与语言大模型"}', 1),
        ('agnes', 'Agnes AI 创意生成服务', 'openai', 'https://apihub.agnes-ai.com/v1', '', '{}', '{"description":"室内效果图生成、视频与视觉"}', 1),
        ('gemini', 'Google AI Studio (Gemini)', 'gemini', 'https://generativelanguage.googleapis.com', '', '{}', '{"description":"Google Gemini 多模态"}', 1),
        ('groq', 'Groq 超高速推理平台', 'openai', 'https://api.groq.com/openai/v1', '', '{}', '{"description":"LPU 极速推理"}', 1),
        ('kilo', 'Kilo AI Gateway', 'openai', 'https://api.kilo.ai/api/gateway', '', '{}', '{"description":"免费视觉通道"}', 1)
    ]

    for p in providers_seed:
        cur.execute("""
            INSERT INTO llm_providers (id, name, protocol, base_url, api_key, secrets_json, config_json, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, base_url=excluded.base_url,
              api_key='',
              updated_at=excluded.updated_at
        """, (*p, now, now))

    # 2. 同步 LiteLLM 解密后的模型
    synced_models = 0
    if models_data:
        for item in models_data:
            model_name = item['model_name']
            real_model = item.get('real_model') or model_name
            prov_raw = item.get('provider') or 'litellm'
            api_key = item.get('api_key') or ''
            api_base = item.get('api_base')

            # 映射为我们的 provider_id
            if 'volcengine' in prov_raw or 'doubao' in real_model:
                prov_id = 'volcengine'
            elif 'agnes' in prov_raw or 'agnes' in real_model:
                prov_id = 'agnes'
            elif 'gemini' in prov_raw or 'gemma' in real_model:
                prov_id = 'gemini'
            elif 'groq' in prov_raw or 'qwen' in real_model:
                prov_id = 'groq'
            elif 'kilo' in prov_raw or 'stepfun' in real_model:
                prov_id = 'kilo'
            else:
                prov_id = 'litellm'

            # 钥匙只写入项目 .env，不进数据库
            if api_key and prov_id != 'litellm':
                remember_env_key(ENV_FOR.get(prov_id, ''), api_key)

            # 推断能力标签
            caps = []
            if any(k in model_name for k in ['vision', 'image_input']) or any(k in real_model for k in ['vision', 'flash-lite', 'gemma']):
                caps.extend(['vision', 'tag'])
            if 'video' in model_name or 'video' in real_model:
                caps.append('video')
            if 'image' in model_name and 'input' not in model_name:
                caps.append('image')
            if not caps or 'text' in model_name:
                caps.append('chat')
            caps_str = ",".join(sorted(list(set(caps))))

            # 插入模型定义（供应商直连模型 + LiteLLM 路由别名）
            # 1. 供应商下的直连模型
            m_id = f"{prov_id}_{real_model}".lower().replace('/', '_').replace(':', '_').replace('.', '_').replace('-', '_')
            cur.execute("""
                INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  model_code=excluded.model_code, capabilities=excluded.capabilities, updated_at=excluded.updated_at
            """, (m_id, prov_id, f"{real_model} ({prov_id})", real_model, caps_str, json.dumps({'tpm': item.get('tpm'), 'rpm': item.get('rpm')}), now, now))

            # 2. LiteLLM 路由入口模型
            litellm_m_id = f"litellm_{model_name}".lower().replace('/', '_').replace(':', '_').replace('.', '_').replace('-', '_')
            cur.execute("""
                INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
                VALUES (?, 'litellm', ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  model_code=excluded.model_code, capabilities=excluded.capabilities, updated_at=excluded.updated_at
            """, (litellm_m_id, f"{model_name} (LiteLLM网关)", model_name, caps_str, json.dumps({'tpm': item.get('tpm'), 'rpm': item.get('rpm')}), 1 if model_name == 'image_agnes_vision' else 0, now, now))
            synced_models += 1

    # 3. 补全 Agnes 图像与视频生成模型
    cur.execute("""
        INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
        VALUES ('agnes_image_2_5_flash', 'agnes', 'Agnes 图像生成 2.5 Flash', 'agnes-image-2.5-flash', 'image', '{\"size\":\"1024x1024\"}', 1, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET model_code=excluded.model_code, capabilities=excluded.capabilities
    """, (now, now))
    cur.execute("""
        INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
        VALUES ('agnes_video_2_5_flash', 'agnes', 'Agnes 视频生成 2.5 Flash', 'agnes-video-2.5-flash', 'video', '{\"seconds\":5}', 1, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET model_code=excluded.model_code, capabilities=excluded.capabilities
    """, (now, now))

    conn.commit()
    conn.close()
    print(f"[sync-litellm] 成功同步 {synced_models} 个模型配置至 SQLite")
    return True

if __name__ == "__main__":
    print("开始从 LiteLLM 解析模型与密钥...")
    data = decrypt_from_docker()
    sync_to_sqlite(data)
