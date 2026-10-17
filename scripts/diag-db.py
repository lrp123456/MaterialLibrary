import sqlite3, os
p = os.path.expanduser("~/.dsh-material-library/material.db")
c = sqlite3.connect(p)
print("color_style tags", c.execute("SELECT COUNT(*) FROM asset_tags at JOIN tag_dict t ON t.id=at.tag_id WHERE t.dimension='color_style'").fetchone())
print("derived tags", c.execute("SELECT COUNT(*) FROM asset_tags WHERE source='derived'").fetchone())
print("tag node_runs", c.execute("SELECT status, COUNT(*) FROM node_runs WHERE node_type='tag' GROUP BY status").fetchall())
print("failed", c.execute("SELECT substr(error,1,100) FROM node_runs WHERE node_type='tag' AND status='failed' LIMIT 3").fetchall())
print("thumb null", c.execute("SELECT COUNT(*) FROM assets WHERE thumb_url IS NULL OR thumb_url=''").fetchone())
print("assets total", c.execute("SELECT COUNT(*) FROM assets").fetchone())
# recent done tag output
rows = c.execute("SELECT asset_fid, substr(output_summary,1,150) FROM node_runs WHERE node_type='tag' AND status='done' ORDER BY updated_at DESC LIMIT 2").fetchall()
for r in rows:
    print("done", r)
# check if any color_style on the fid from diag
fid = "~1T2NL7dp5vbkD77c2PyA0k9pTbl5Bm5WXrriI3mhM-TBFnvRu7Jap6NphifdXGkgbAo7fTw19fk6rD1D_8fucDU"
print("fid tags color_style", c.execute("SELECT t.dir FROM asset_tags at JOIN tag_dict t ON t.id=at.tag_id WHERE at.asset_fid=? AND t.dimension='color_style'", (fid,)).fetchall())
print("fid colors", c.execute("SELECT hex,role,basic_color,name FROM asset_colors WHERE asset_fid=?", (fid,)).fetchall())
c.close()
