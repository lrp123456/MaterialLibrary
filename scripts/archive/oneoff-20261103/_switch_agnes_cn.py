#!/usr/bin/env python3
"""Switch Agnes to official api.agnes-ai.cn and install the two valid keys."""
import sys
sys.exit('供应商钥匙只读写项目 .env，这个脚本已停用')
import json
import os
import sqlite3
import time

SECRETS = '/home/lrp/.dsh-material-library/providers-secrets.json'
DB = '/home/lrp/.dsh-material-library/material.db'
K1 = os.environ.get('AGNES_API_KEY', '').strip()
K2 = os.environ.get('AGNES_API_KEY_2', K1).strip()
if not K1:
    raise SystemExit('需要环境变量 AGNES_API_KEY，脚本里不再写密钥')
CN = 'https://api.agnes-ai.cn'
CN_V1 = 'https://api.agnes-ai.cn/v1'
NOW = int(time.time() * 1000)


def mask(k):
    return (k or '')[:10] + '…' if k else 'None'


def main():
    # secrets file
    d = json.load(open(SECRETS)) if os.path.exists(SECRETS) else {}
    d['agnes'] = {
        'api_key': K1,
        'api_keys': [K2],
        'secrets_json': json.dumps({'api_keys': [K1, K2]}),
        'base_url': CN_V1,
    }
    with open(SECRETS, 'w') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(SECRETS, 0o600)
    except Exception:
        pass
    print('secrets: pool=2 (k1 primary, k2 rotate)')

    c = sqlite3.connect(DB)
    # llm_providers.agnes
    c.execute(
        "update llm_providers set base_url=?, api_key=?, secrets_json=?, updated_at=? where id='agnes'",
        (CN_V1, K1, json.dumps({'api_keys': [K1, K2]}, ensure_ascii=False), NOW),
    )
    # gen_adapters image
    row = c.execute("select secrets_json, config_json from gen_adapters where id='agnes_image'").fetchone()
    if row:
        sj = {}
        try:
            sj = json.loads(row[0] or '{}') if row[0] else {}
        except Exception:
            sj = {}
        sj['apiKey'] = K1
        sj['api_keys'] = [K1, K2]
        c.execute(
            "update gen_adapters set base_url=?, secrets_json=?, updated_at=? where id='agnes_image'",
            (CN_V1, json.dumps(sj, ensure_ascii=False), NOW),
        )
        print('gen_adapters.agnes_image ->', CN_V1)
    # gen_adapters video (no /v1 suffix in prior config)
    row = c.execute("select secrets_json from gen_adapters where id='agnes_video'").fetchone()
    if row:
        sj = {}
        try:
            sj = json.loads(row[0] or '{}') if row[0] else {}
        except Exception:
            sj = {}
        sj['apiKey'] = K1
        sj['api_keys'] = [K1, K2]
        c.execute(
            "update gen_adapters set base_url=?, secrets_json=?, updated_at=? where id='agnes_video'",
            (CN, json.dumps(sj, ensure_ascii=False), NOW),
        )
        print('gen_adapters.agnes_video ->', CN)
    c.commit()
    c.close()
    print('done. keys:', mask(K1), mask(K2))


if __name__ == '__main__':
    main()
