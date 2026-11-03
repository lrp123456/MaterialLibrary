#!/usr/bin/env bash
set -u
DB="${ML_DB:-/home/lrp/.dsh-material-library/material.db}"
DATA="${ML_DATA:-/home/lrp/.dsh-material-library}"

echo "=== mmexport assets ==="
sqlite3 "$DB" "SELECT fid, kind, COALESCE(category,''), file_name, COALESCE(main_derivative_id,''), substr(COALESCE(thumb_url,''),1,50) FROM assets WHERE file_name LIKE 'mmexport%' ORDER BY rowid DESC LIMIT 20;"

echo "=== audio/music assets ==="
sqlite3 "$DB" "SELECT fid, kind, COALESCE(category,''), file_name, COALESCE(main_derivative_id,'') FROM assets WHERE file_name LIKE '%.mp3' OR kind='audio' OR category='music' LIMIT 15;"

echo "=== derivatives sample for mmexport ==="
sqlite3 "$DB" "SELECT d.id, d.asset_fid, d.kind, d.storage_type, substr(COALESCE(d.local_path,''),1,80), substr(COALESCE(d.remote_path,''),1,60) FROM derivatives d JOIN assets a ON a.fid=d.asset_fid WHERE a.file_name LIKE 'mmexport%' LIMIT 20;"

echo "=== thumb cache ==="
ls "$DATA/cache/thumbs" 2>/dev/null | wc -l
ls "$DATA/cache/thumbs" 2>/dev/null | head -5

echo "=== previews dir ==="
ls "$DATA/previews" 2>/dev/null | wc -l
ls "$DATA/previews" 2>/dev/null | head -5

echo "=== nas root sample ==="
ls /mnt/synology/material 2>&1 | head -10
