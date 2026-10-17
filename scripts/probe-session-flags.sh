#!/usr/bin/env bash
CLI=/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs
NODE=/home/lrp/.local/node/bin/node
echo "=== without session flags ==="
$NODE $CLI get-user-info
echo
echo "=== with session-id only ==="
$NODE $CLI get-user-info --session-id dsh-ml-123 || true
echo
echo "=== with session-input only ==="
$NODE $CLI get-user-info --session-input 'dsh-material-library' || true
echo
echo "=== with both (current server) ==="
$NODE $CLI get-user-info --session-id dsh-ml-123 --session-input 'dsh-material-library' || true
echo
echo "=== with AI_AGENT=claude-code + session ==="
AI_AGENT=claude-code CLAUDECODE=1 $NODE $CLI get-user-info --session-id dsh-ml-123 --session-input 'x' || true
