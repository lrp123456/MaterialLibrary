#!/usr/bin/env python3
import sqlite3
c = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
print('=== latest runs ===')
for r in c.execute("select id, trigger, status, asset_count, created_at from runs order by created_at desc limit 5"):
    print(r)
print('=== latest restage node_runs ===')
for r in c.execute("""
  select id, run_id, node_type, asset_fid, status, error, not_before, updated_at
  from node_runs
  where node_type like 'restage%'
  order by id desc limit 12
"""):
    err = (r[5] or '')[:80]
    print(r[0], r[2], r[3][-8:] if r[3] else '', r[4], 'nb', r[6], err)
print('=== queue counts ===')
for r in c.execute("select status, count(*) from node_runs group by status"):
    print(r)
print('=== gen_adapters agnes ===')
for r in c.execute("select id, base_url, substr(secrets_json,1,60) from gen_adapters where id like 'agnes%'"):
    print(r)
print('=== provider agnes ===')
for r in c.execute("select id, base_url, length(api_key), secrets_json from llm_providers where id='agnes'"):
    print(r[0], r[1], 'keylen', r[2], r[3][:100])
c.close()
