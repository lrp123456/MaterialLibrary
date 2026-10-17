const Database = require('better-sqlite3')
const db = new Database('/home/lrp/.dsh-material-library/material.db', { readonly: true })
console.log(db.prepare('SELECT id, username, role, created_at FROM users').all())
db.close()
