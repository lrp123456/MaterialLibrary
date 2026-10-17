#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re, subprocess, os, json
p='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
s=open(p,encoding='utf-8',errors='ignore').read()
for pat in ['禁止', 'Agent 环境', 'agent环境', '当前环境', 'is_wild', 'isWild', 'runTimeType', 'wild']:
    print(pat, s.count(pat))

# find runTimeType wild
i=s.find('runTimeType')
print('runTimeType first', i)
print(s[i-50:i+200] if i>=0 else '')

# find failWithCode related to agent
for m in re.finditer(r'failWithCode\([^)]{0,80}\)', s):
    t=m.group(0)
    if 'agent' in t.lower() or 'Agent' in t:
        print(t)

# execute get-user-info like the server does
cli='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
cmd=['/home/lrp/.local/node/bin/node', cli, 'get-user-info', '--session-id', 'test-ml', '--session-input', 'dsh-material-library']
print('RUN', ' '.join(cmd))
env=os.environ.copy()
# no agent env
r=subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
print('code', r.returncode)
print('stdout last 1500:')
print(r.stdout[-1500:])
print('stderr last 500:')
print(r.stderr[-500:])

# retry with CLAUDECODE=1
env2=env.copy(); env2['CLAUDECODE']='1'; env2['AI_AGENT']='claude-code'
r2=subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env2)
print('=== with CLAUDECODE=1 ===')
print('code', r2.returncode)
print(r2.stdout[-800:])
print(r2.stderr[-300:])
