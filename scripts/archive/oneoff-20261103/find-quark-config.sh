#!/usr/bin/env bash
echo "=== skill dir ==="
ls -la /home/lrp/.agents/skills/quarkclouddrive/ 2>/dev/null | head -30
echo "=== skill scripts ==="
ls -la /home/lrp/.agents/skills/quarkclouddrive/scripts/ 2>/dev/null | head -20
echo "=== claude skill ==="
ls -la /home/lrp/.claude/skills/quarkclouddrive/ 2>/dev/null | head -20
echo "=== home quark dirs ==="
ls -la /home/lrp/.quarkclouddrive /home/lrp/.quark-drive 2>/dev/null
echo "=== find config.json under skills ==="
find /home/lrp/.agents/skills/quarkclouddrive /home/lrp/.claude/skills/quarkclouddrive /home/lrp/.quarkclouddrive /home/lrp/.config -name 'config.json' 2>/dev/null | head
echo "=== cwd config ==="
ls -la ./config.json /home/lrp/.quarkclouddrive/config.json 2>/dev/null
echo "=== try get-user-info verbose ==="
/home/lrp/.local/node/bin/node /home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs get-user-info --verbose 2>&1 | tail -40
