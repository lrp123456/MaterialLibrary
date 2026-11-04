#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
export ML_PORT=30001
export NO_PROXY=127.0.0.1,localhost,::1
cd /home/lrp/my_folder/smu/dsh_plugins/material_library || exit 1
mkdir -p /home/lrp/.dsh-material-library/logs
exec /home/lrp/.local/node/bin/node server.js
