#!/usr/bin/env bash
CLI=/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs
echo "=== agent forbid msg ==="
grep -o '无法识别当前 Agent 环境[^，。"]*' "$CLI" | head -5
echo "=== detectAgent function snippets ==="
python3 - <<'PY'
import re
p='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
s=open(p,encoding='utf-8',errors='ignore').read()
for m in re.finditer(r'detectAgent\s*\(\s*\)\s*\{[^}]{0,800}', s):
    print(m.group(0)[:500])
    print('---')
# also search CLAUDE, OPENCLAW, MIMO env
for key in ['CLAUDE','OPENCLAW','MIMO','CODEX','CURSOR','AGENT','process.env']:
    idx=s.find(key)
    print(key, 'first at', idx)
# error message context
i=s.find('无法识别当前 Agent')
if i>=0:
    print('CTX:', s[max(0,i-200):i+120])
PY
