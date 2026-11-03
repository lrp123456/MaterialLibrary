#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, os, subprocess
NODE='/home/lrp/.local/node/bin/node'
paths=[
 '/home/lrp/.agents/skills/quarkclouddrive/openclaw/config.json',
 '/home/lrp/.claude/skills/quarkclouddrive/claudecode/config.json',
 '/home/lrp/.claude/skills/quarkclouddrive/openclaw/config.json',
]
for p in paths:
    print('====', p)
    if not os.path.exists(p):
        print('missing'); continue
    d=json.load(open(p))
    def keys(o, pref=''):
        if isinstance(o, dict):
            for k,v in o.items():
                if isinstance(v,(dict,list)):
                    print(pref+k, type(v).__name__, (len(v) if hasattr(v,'__len__') else ''))
                    if isinstance(v,dict) and pref.count('.')<2:
                        keys(v, pref+k+'.')
                else:
                    sv=str(v)
                    if len(sv)>20: sv=sv[:8]+'...'+str(len(sv))
                    print(pref+k, '=', sv)
    keys(d)

# try CLI from .claude skill with CLAUDECODE
cli='/home/lrp/.claude/skills/quarkclouddrive/scripts/quark-drive.cjs'
print('claude cli exists', os.path.exists(cli))
env=os.environ.copy(); env['CLAUDECODE']='1'; env['CLAUDE_CODE_SESSION_ID']='probe'
r=subprocess.run([NODE,cli,'get-user-info'], capture_output=True, text=True, timeout=60, env=env)
print('claude+CLAUDECODE', r.returncode, r.stdout[-200:], r.stderr[-150:])

# openclaw
cli2='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
env2=os.environ.copy(); env2['OPENCLAW_CLI']='1'; env2['OPENCLAW_SERVICE_MARKER']='openclaw'
r2=subprocess.run([NODE,cli2,'get-user-info'], capture_output=True, text=True, timeout=60, env=env2)
print('agents+OPENCLAW', r2.returncode, r2.stdout[-200:], r2.stderr[-150:])

env3=os.environ.copy(); env3['AI_AGENT']='openclaw'; env3['OPENCLAW_HOME']='/home/lrp/.agents/skills/quarkclouddrive/openclaw'
r3=subprocess.run([NODE,cli2,'get-user-info'], capture_output=True, text=True, timeout=60, env=env3)
print('OPENCLAW_HOME', r3.returncode, r3.stdout[-200:])
