#!/usr/bin/env bash
ROOT=/home/lrp/my_folder/smu/KX2BFK_umbra_quick/apps/ts-api-gateway/src
grep -Rnl mlsGen "$ROOT" --include='*.ts' | head
echo '--- media-gen ---'
grep -Rn media-gen "$ROOT" --include='*.ts' | head
echo '--- POST media ---'
grep -Rn "app\.\(post\|get\).*media" "$ROOT" --include='*.ts' | head
