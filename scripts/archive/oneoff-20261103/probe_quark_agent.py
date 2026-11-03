#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re
p='/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'
s=open(p,encoding='utf-8',errors='ignore').read()
# unicode escapes for 无法识别
for pat in [r'无法识别', r'\\u65e0\\u6cd5\\u8bc6\\u522b', r'Agent 环境', r'detectAgent', r'function ae', r'ae=function', r'ae=']:
    print('PAT', pat, 'count', len(re.findall(pat, s)))

# find ae definition near detectAgent
i=s.find('detectAgent(){return ae()')
print('detectAgent at', i)
print(s[i-200:i+100])

# search unicode message
u = '\\u65e0\\u6cd5\\u8bc6\\u522b\\u5f53\\u524d Agent'
j=s.find(u)
print('unicode msg at', j)
if j<0:
    # try raw
    j=s.find('禁止继续使用')
    print('禁止继续使用 at', j)
    if j>=0: print(s[j-150:j+80])

# look for OPENCLAW CLAUDE CODEX context
for key in ['OPENCLAW','CLAUDE_CODE','CURSOR_AGENT','CODEX','claude-code','openclaw']:
    idx=0
    n=0
    while n<3:
        k=s.find(key, idx)
        if k<0: break
        print('---', key, k, '---')
        print(s[k-80:k+120].replace('\n',' ')[:200])
        idx=k+len(key)
        n+=1

# find function ae(
m=re.search(r'function ae\(\)\{.{0,1200}', s)
if m:
    print('function ae snippet:')
    print(m.group(0)[:800])
m2=re.search(r'ae=\(\)=>\{.{0,1200}', s)
if m2:
    print('ae arrow snippet:')
    print(m2.group(0)[:800])
