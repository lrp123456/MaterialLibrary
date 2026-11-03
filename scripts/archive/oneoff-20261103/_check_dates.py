import json

with open('scripts/ba_records_map.json', 'r', encoding='utf-8') as f:
    ba_map = json.load(f)

dates = sorted([r['createTime'] for r in ba_map.values()])
print('Min createTime:', dates[0])
print('Max createTime:', dates[-1])
print('Sample dates:', dates[:5], '...', dates[-5:])
