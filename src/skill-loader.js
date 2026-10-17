/**
 * Load pe-<model>/SKILL.md from skills/media-prompt-skills and prepend the contract header.
 * Skips media-prompt-gateway (4-section output) and pe-agnes-text.
 */
const fs = require('fs')
const path = require('path')

const AT = 'User and internal refs use @imageN @videoN @audioN (N from 1). Do not use other placeholders. 用户与内部一律用 @图片N @视频N @音频N。'
const ONLY = 'Output only the final generation prompt. No explanation, titles, markdown, or 4-section template. 只输出最终生成提示词。'
const PARAM_HYGIENE = 'Do not write camera brands, UE5, 8k, 60fps, or empty buzzwords. Size/duration/ratio are params, not prompt text. 不要写相机型号、UE5、8k、60fps 等套话，分辨率/时长/比例不写进正文。'

const SKIP_SKILLS = new Set(['media-prompt-gateway', 'pe-agnes-text'])

function skillsRoot() {
  if (process.env.SKILLS_ROOT) return process.env.SKILLS_ROOT
  return path.join(__dirname, '..', 'skills', 'media-prompt-skills')
}

function readMap() {
  const p = path.join(skillsRoot(), 'model-map.json')
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

function stripFrontmatter(raw) {
  const s = String(raw || '')
  if (s.startsWith('---')) {
    const end = s.indexOf('\n---', 3)
    if (end !== -1) return s.slice(end + 4).trim()
  }
  return s.trim()
}

function contractHeader() {
  return [ONLY, AT, PARAM_HYGIENE].join('\n')
}

function skillDirFor(modelId) {
  const id = String(modelId || '').trim()
  if (!id) return null
  const map = readMap()
  if (map[id]) return map[id]
  const n = id.toLowerCase().replace(/_/g, '-')
  for (const [k, v] of Object.entries(map)) {
    if (n.includes(String(k).toLowerCase().replace(/_/g, '-'))) return v
  }
  if (n.includes('seedance-2-5') || n.includes('seedance2.5') || n.includes('seedance2-5')) return 'pe-seedance25'
  if (n.includes('seedance-2-0') || n.includes('seedance2.0') || n.includes('seedance2-0')) return 'pe-seedance20'
  if (n.includes('seedream') && n.includes('lite')) return 'pe-seedream5-lite'
  if (n.includes('seedream')) return 'pe-seedream5-pro'
  if (n.includes('agnes') && n.includes('video')) return 'pe-agnes-video'
  if (n.includes('agnes') && n.includes('image')) return 'pe-agnes-image'
  if (n.includes('omni')) return 'pe-gemini-omni'
  if (n.includes('veo')) return 'pe-veo'
  if (n.includes('lyria')) return 'pe-lyria-music'
  if ((n.includes('gemini') && n.includes('image')) || n.includes('nano-banana') || n.includes('nano_banana')) return 'pe-gemini-image'
  return null
}

function loadSkillFile(skillDir) {
  if (!skillDir || SKIP_SKILLS.has(skillDir)) return null
  const fp = path.join(skillsRoot(), skillDir, 'SKILL.md')
  if (!fs.existsSync(fp)) return null
  const body = stripFrontmatter(fs.readFileSync(fp, 'utf8'))
  if (!body) return null
  return `${contractHeader()}\n\n---\nFollow the official prompt guide below and rewrite the user text.\n\n${body}`
}

function loadSkillForModel(modelId) {
  return loadSkillFile(skillDirFor(modelId))
}

function createSkill({ id, name, description, content, modelIds }) {
  const dirName = String(id || '').trim()
  if (!/^pe-[a-z0-9-]+$/.test(dirName)) throw new Error('id must be pe- plus lowercase slug')
  if (SKIP_SKILLS.has(dirName)) throw new Error(`cannot overwrite skipped skill: ${dirName}`)
  const root = skillsRoot()
  const dir = path.join(root, dirName)
  fs.mkdirSync(dir, { recursive: true })
  const title = String(name || dirName)
  const desc = String(description || title)
  const body = String(content || '').trim()
  if (!body) throw new Error('content is required')
  const md = `---\nname: ${dirName}\ndescription: ${desc}\n---\n\n# ${title}\n\n${body}\n`
  fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf8')
  const map = readMap()
  for (const mid of Array.isArray(modelIds) ? modelIds : []) {
    if (mid) map[String(mid)] = dirName
  }
  fs.writeFileSync(path.join(root, 'model-map.json'), JSON.stringify(map, null, 2), 'utf8')
  return { id: dirName, path: path.join(dir, 'SKILL.md'), map }
}

module.exports = {
  skillsRoot,
  loadSkillForModel,
  skillDirFor,
  createSkill,
  contractHeader,
}
