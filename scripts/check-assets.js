const Database = require('better-sqlite3')
const db = new Database(process.argv[2] || '/home/lrp/.dsh-material-library/material.db', { readonly: true })
const q = (sql) => {
  try { return db.prepare(sql).all() } catch (e) { return [{ error: e.message }] }
}
console.log('tables:', q("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name).join(','))
console.log('assets:', q('SELECT COUNT(*) c FROM assets'))
console.log('status:', q('SELECT status, COUNT(*) c FROM assets GROUP BY status'))
console.log('auth:', q('SELECT auth_state, COUNT(*) c FROM assets GROUP BY auth_state'))
console.log('kind:', q('SELECT kind, COUNT(*) c FROM assets GROUP BY kind'))
console.log('category:', q('SELECT category, COUNT(*) c FROM assets GROUP BY category'))
console.log('rep:', q('SELECT is_representative, COUNT(*) c FROM assets GROUP BY is_representative'))
console.log('dup:', q("SELECT CASE WHEN dup_group_id IS NULL THEN 'null' ELSE 'set' END d, COUNT(*) c FROM assets GROUP BY d"))
console.log('browse_ready:', q("SELECT COUNT(*) c FROM assets WHERE status IN ('ready','ready_with_flags','tagging_done','gating_passed','qc') AND (auth_state IS NULL OR auth_state IN ('live','frozen')) AND (is_representative = 1 OR dup_group_id IS NULL)"))
console.log('browse_image:', q("SELECT COUNT(*) c FROM assets WHERE status IN ('ready','ready_with_flags','tagging_done','gating_passed','qc') AND (auth_state IS NULL OR auth_state IN ('live','frozen')) AND (is_representative = 1 OR dup_group_id IS NULL) AND kind='image' AND COALESCE(category,'interior') NOT IN ('furniture','portrait','music')"))
console.log('sample:', q('SELECT fid,file_name,kind,status,auth_state,category,is_representative,dup_group_id FROM assets LIMIT 8'))
db.close()
