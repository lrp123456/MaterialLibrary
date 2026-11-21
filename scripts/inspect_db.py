import sqlite3

conn = sqlite3.connect("/home/lrp/.dsh-material-library/material.db")
cur = conn.cursor()

def dump_table(name):
    print(f"\n=== {name} ===")
    cols = [c[1] for c in cur.execute(f"PRAGMA table_info({name})").fetchall()]
    print("Cols:", cols)
    for r in cur.execute(f"SELECT * FROM {name}").fetchall():
        row_dict = dict(zip(cols, r))
        # Mask secrets
        for k in row_dict:
            if "key" in k.lower() or "secret" in k.lower() or "password" in k.lower():
                val = str(row_dict[k])
                row_dict[k] = val[:4] + "..." if len(val) > 4 else ("***" if val else "")
        print(row_dict)

dump_table("gen_adapters")
dump_table("llm_endpoints")
dump_table("llm_providers")
dump_table("gen_job_bindings")
