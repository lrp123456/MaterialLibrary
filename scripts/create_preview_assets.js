const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

async function createPreviews() {
  const dirs = [
    path.join(__dirname, '../data/previews'),
    path.join(os.homedir(), '.dsh-material-library/previews')
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });

  const items = [
    { name: 'sofa_single.png', icon: '🛋️', label: '极简单人电动沙发', bg: '#2A2D34' },
    { name: 'chair_01.png', icon: '🪑', label: '意式轻奢休闲单椅', bg: '#3F4B3B' },
    { name: 'table_01.png', icon: '☕', label: '极简悬浮岩板茶几', bg: '#4A3B32' }
  ];

  for (const it of items) {
    const svg = `
      <svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="400" rx="40" fill="${it.bg}" fill-opacity="0.9"/>
        <text x="200" y="180" font-size="72" text-anchor="middle" dominant-baseline="middle">${it.icon}</text>
        <text x="200" y="270" font-size="24" font-family="sans-serif" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${it.label}</text>
      </svg>
    `;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    for (const d of dirs) {
      const p = path.join(d, it.name);
      fs.writeFileSync(p, buf);
      console.log('Written:', p);
    }
  }
  console.log('All previews created.');
}

createPreviews().catch(console.error);
