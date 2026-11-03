const { openDb } = require('../src/db');
const db = openDb('/home/lrp/.dsh-material-library');
const now = Date.now();
const models = [
  ['litellm_gemini_2_5_flash', 'litellm', 'Gemini 2.5 Flash (LiteLLM)', 'gemini-2.5-flash', 'chat,vision,tag', '{"temperature":0.2,"max_tokens":2048}', 1, 1],
  ['litellm_gemini_2_5_flash_lite', 'litellm', 'Gemini 2.5 Flash-Lite (LiteLLM)', 'gemini-2.5-flash-lite', 'chat,vision,tag', '{"temperature":0.2,"max_tokens":2048}', 0, 1],
  ['litellm_gemini_3_1_flash_lite', 'litellm', 'Gemini 3.1 Flash-Lite (LiteLLM)', 'gemini-3.1-flash-lite', 'chat,vision,tag', '{"temperature":0.2,"max_tokens":2048}', 0, 1],
  ['litellm_gemma_4_26b_a4b_it', 'litellm', 'Gemma 4 26B IT (LiteLLM)', 'gemma-4-26b-a4b-it', 'chat,vision', '{"temperature":0.2,"max_tokens":2048}', 0, 1]
];
for (const m of models) {
  db.prepare(`
    INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET model_code=excluded.model_code, capabilities=excluded.capabilities, updated_at=excluded.updated_at
  `).run(...m, now, now);
}
console.log('Successfully seeded Gemini models into llm_models');
db.close();
