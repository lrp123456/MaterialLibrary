#!/bin/bash
PID=858515
echo "=== cwd ==="
ls -l /proc/$PID/cwd
echo "=== environ ==="
tr '\0' '\n' < /proc/$PID/environ | grep -E 'ML_|HOME|DATA|PATH' | head -20
echo "=== open db files ==="
ls -l /proc/$PID/fd 2>/dev/null | grep -iE 'material|\.db' || true
echo "=== login via localhost ==="
curl -s -m 5 -X POST http://127.0.0.1:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}"
echo
curl -s -m 5 -X POST http://127.0.0.1:8787/api/viewer/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}"
echo
# compare hashes in the DB the process likely uses
echo "=== hash check in default db ==="
node -e '
const crypto=require("crypto");
const Database=require("/home/lrp/my_folder/smu/dsh_plugins/material_library/node_modules/better-sqlite3");
const db=new Database("/home/lrp/.dsh-material-library/material.db",{readonly:true});
const u=db.prepare("SELECT username,salt,password_hash FROM users WHERE username=?").get(process.env.ML_USER||"");
const h=crypto.scryptSync("", u.salt, 64).toString("hex");
console.log("match", h===u.password_hash, "salt", u.salt);
'
