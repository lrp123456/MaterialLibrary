import sqlite3
import json
from datetime import datetime

DB_PATH = '/home/lrp/.dsh-material-library/material.db'
MAP_PATH = 'scripts/ba_records_map.json'

def main():
    with open(MAP_PATH, 'r', encoding='utf-8') as f:
        ba_map = json.load(f)

    print(f"Loaded {len(ba_map)} records from {MAP_PATH}")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    rows = cur.execute("SELECT id, created_at FROM creation_templates WHERE id LIKE 'ba_%'").fetchall()
    print(f"Found {len(rows)} ba_ templates in {DB_PATH}")

    updated = 0
    errors = 0

    for cid, old_ts in rows:
        rid = cid[3:]
        if rid in ba_map:
            create_time_str = ba_map[rid].get('createTime')
            if not create_time_str:
                print(f"Warning: no createTime for {cid}")
                continue
            try:
                dt = datetime.strptime(create_time_str.strip(), '%Y-%m-%d %H:%M:%S')
                ts_ms = int(dt.timestamp() * 1000)
                cur.execute("UPDATE creation_templates SET created_at = ? WHERE id = ?", (ts_ms, cid))
                updated += 1
            except Exception as e:
                print(f"Error parsing date {create_time_str} for {cid}: {e}")
                errors += 1
        else:
            print(f"Record not in map: {cid}")

    con.commit()
    print(f"Successfully updated {updated}/{len(rows)} templates (errors: {errors})")

    # Verify distribution after update
    dist = cur.execute("""
        SELECT strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch', 'localtime')) as dt, count(*)
        FROM creation_templates
        WHERE id LIKE 'ba_%'
        GROUP BY dt
        ORDER BY dt DESC
    """).fetchall()

    print("\nUpdated creation date distribution (Top 15 most recent days):")
    for d, c in dist[:15]:
        print(f"  {d}: {c} templates")
    print(f"Total distinct dates: {len(dist)}")

    con.close()

if __name__ == '__main__':
    main()
