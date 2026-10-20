/**
 * Dump gen-jobs + LAN /auth/me. Run in WSL against :30001.
 */
const BASE = process.env.MLS_BASE_URL || 'http://127.0.0.1:30001'
const USER = process.env.ML_ADMIN_USER || 'admin'
const PASS = process.env.ML_ADMIN_PASS || ''

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 400) } }
  return { status: res.status, json }
}

async function main() {
  const lan = await req('/api/auth/me')
  console.log('LAN /auth/me', lan.status, JSON.stringify(lan.json?.data || lan.json).slice(0, 300))

  const login = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } })
  const token = login.json?.data?.token
  console.log('login', login.status, login.json?.data?.user?.username || JSON.stringify(login.json).slice(0, 200))
  if (!token) process.exit(1)

  const jobs = await req('/api/governance/gen-jobs', { token })
  console.log('jobs status', jobs.status)
  const list = jobs.json?.data || []
  if (Array.isArray(list)) {
    for (const j of list) {
      console.log(`  ${j.job_id}=${j.model_id} capable=${(j.capable || []).length}`)
    }
  } else {
    console.log(JSON.stringify(jobs.json).slice(0, 800))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
