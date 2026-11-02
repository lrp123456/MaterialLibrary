const crypto = require('crypto');

const GUIDE_TYPES = new Set(['add', 'remove', 'replace', 'resurface', 'blank', 'custom']);

function rowToGuide(row) {
  let slots = {};
  try {
    slots = JSON.parse(row.slots_json || '{}');
  } catch (_) {
    slots = {};
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    slots,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizePayload(body) {
  const name = String(body?.name || '').trim();
  const type = String(body?.type || '').trim();
  if (!name) {
    const err = new Error('请给这条指南起个名字');
    err.status = 400;
    throw err;
  }
  if (!GUIDE_TYPES.has(type)) {
    const err = new Error('指南类型不正确');
    err.status = 400;
    throw err;
  }
  const slots = body?.slots && typeof body.slots === 'object' ? body.slots : {};
  return { name, type, slots };
}

function listGuides(db, userId) {
  const rows = db.prepare(`
    SELECT * FROM ba_operation_guides
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(String(userId));
  return rows.map(rowToGuide);
}

function createGuide(db, userId, body) {
  const payload = normalizePayload(body);
  const now = Date.now();
  const id = `guide_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(`
    INSERT INTO ba_operation_guides (id, user_id, name, type, slots_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, String(userId), payload.name, payload.type, JSON.stringify(payload.slots), now, now);
  return rowToGuide(db.prepare(`SELECT * FROM ba_operation_guides WHERE id = ?`).get(id));
}

function updateGuide(db, userId, id, body) {
  const existing = db.prepare(`
    SELECT * FROM ba_operation_guides WHERE id = ? AND user_id = ?
  `).get(String(id), String(userId));
  if (!existing) return null;
  const payload = normalizePayload({
    name: body?.name ?? existing.name,
    type: body?.type ?? existing.type,
    slots: body?.slots ?? JSON.parse(existing.slots_json || '{}')
  });
  const now = Date.now();
  db.prepare(`
    UPDATE ba_operation_guides
    SET name = ?, type = ?, slots_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(payload.name, payload.type, JSON.stringify(payload.slots), now, String(id), String(userId));
  return rowToGuide(db.prepare(`SELECT * FROM ba_operation_guides WHERE id = ?`).get(String(id)));
}

function deleteGuide(db, userId, id) {
  const result = db.prepare(`
    DELETE FROM ba_operation_guides WHERE id = ? AND user_id = ?
  `).run(String(id), String(userId));
  return result.changes > 0;
}

module.exports = {
  listGuides,
  createGuide,
  updateGuide,
  deleteGuide
};
