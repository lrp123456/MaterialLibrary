#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re
p='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
s=open(p,encoding='utf-8',errors='ignore').read()
# find function ae
m=re.search(r'function ae\(\)\{.{0,2000}', s)
print('function ae:', m.group(0)[:1500] if m else 'NOT FOUND')
# Rt function that maps agent
i=s.find('function Rt')
print('Rt at', i)
if i>=0: print(s[i:i+400])
# permission config paths
for key in ['.quark', 'quark-drive', 'config.json', 'permissionManager', 'getWorkDir', 'agentConfig']:
    print(key, s.count(key))
# find config dir constants
for m in re.finditer(r'\.agents[^"\']{0,60}', s):
    print('path', m.group(0)[:80])
    break
for m in re.finditer(r'quarkclouddrive[^"\']{0,40}', s):
    print('qk', m.group(0)[:60])
    if m.start()>300000: break
# list local auth config files
import os
home='/home/lrp'
for root,dirs,files in os.walk(home):
    if 'node_modules' in root or '.git' in root: continue
    for f in files:
        if 'quark' in f.lower() or 'qkpan' in f.lower() or 'agent.json' in f.lower():
            fp=os.path.join(root,f)
            if 'quark-drive.cjs' in fp: continue
            if os.path.getsize(fp)<500000:
                print('FILE', fp, os.path.getsize(fp))
    if root.count(os.sep)-home.count(os.sep)>4:
        dirs.clear()
