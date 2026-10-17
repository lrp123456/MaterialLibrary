#!/usr/bin/env bash
set -e
EX=/tmp/qk1019
NODE=/home/lrp/.local/node/bin/node
export PATH="/home/lrp/.local/node/bin:$PATH"
export OPENCLAW_CLI=1
export OPENCLAW_SERVICE_MARKER=openclaw

install_one() {
  local dest="$1"
  echo "==== install to $dest ===="
  mkdir -p "$dest"
  # preserve configs
  local bak="/tmp/qk-cfg-bak-$(basename "$dest")-$$"
  mkdir -p "$bak"
  if [ -d "$dest/openclaw" ]; then cp -a "$dest/openclaw" "$bak/" 2>/dev/null || true; fi
  if [ -d "$dest/claudecode" ]; then cp -a "$dest/claudecode" "$bak/" 2>/dev/null || true; fi
  if [ -f "$dest/config.json" ]; then cp -a "$dest/config.json" "$bak/" 2>/dev/null || true; fi

  # replace package files (keep other dirs)
  rm -rf "$dest/scripts" "$dest/references" "$dest/SKILL.md"
  cp -a "$EX/scripts" "$dest/scripts"
  cp -a "$EX/references" "$dest/references"
  cp -a "$EX/SKILL.md" "$dest/SKILL.md"
  chmod +x "$dest/scripts/"*.sh "$dest/scripts/quark-drive.cjs" 2>/dev/null || true

  # restore configs
  if [ -d "$bak/openclaw" ]; then cp -a "$bak/openclaw" "$dest/" ; fi
  if [ -d "$bak/claudecode" ]; then cp -a "$bak/claudecode" "$dest/" ; fi
  if [ -f "$bak/config.json" ]; then cp -a "$bak/config.json" "$dest/" ; fi
  rm -rf "$bak"
  echo "version in SKILL.md:"; grep -m1 '^version:' "$dest/SKILL.md" || true
}

install_one /home/lrp/.agents/skills/quarkclouddrive
install_one /home/lrp/.claude/skills/quarkclouddrive

echo "==== verify CLI ===="
CLI=/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs
$NODE "$CLI" --version || true

echo "==== login with CAC ===="
$NODE "$CLI" login --token 'CAC-e90217f7e6ce42a8b0bba4cccf2698b8' --session-id dsh-ml-login --session-input 'dsh-material-library'
echo
echo "==== get-user-info ===="
$NODE "$CLI" get-user-info --session-id dsh-ml-info --session-input 'dsh-material-library'
echo
