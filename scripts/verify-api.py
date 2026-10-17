import urllib.request
import json
import urllib.parse

# 1. Login
req = urllib.request.Request(
    'http://127.0.0.1:30001/api/auth/login',
    data=json.dumps({'username': '504391119', 'password': ''}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
resp = urllib.request.urlopen(req)
login_data = json.loads(resp.read().decode('utf-8'))
token = login_data['data']['token']
print('Login OK, token:', token[:10] + '...')

# 2. Query assets & verify filterOptions
req2 = urllib.request.Request(
    'http://127.0.0.1:30001/api/assets?page=1&pageSize=5',
    headers={'Authorization': f'Bearer {token}'}
)
data2 = json.loads(urllib.request.urlopen(req2).read().decode('utf-8'))['data']
print('Total assets:', data2['total'])
print('Items returned:', len(data2['items']))

fo = data2['filterOptions']
print('FilterOptions keys:', list(fo.keys()))
assert 'colors' in fo, 'colors should be in filterOptions'
assert 'color_style' in fo, 'color_style should be in filterOptions'
assert 'palette' not in fo, 'palette should be removed from filterOptions'
print('Colors facet count:', len(fo['colors']), 'sample:', fo['colors'][:3])
print('Color_style facet count:', len(fo['color_style']), 'sample:', fo['color_style'][:3])

# Check item mediaToken
item0 = data2['items'][0]
print('Item 0 fid:', item0['fid'][:20], 'mediaToken:', item0.get('mediaToken'))
assert item0.get('mediaToken'), 'item should have mediaToken'

# 3. Test colors filter (colors=白)
color_param = urllib.parse.quote('白')
req3 = urllib.request.Request(
    f'http://127.0.0.1:30001/api/assets?colors={color_param}',
    headers={'Authorization': f'Bearer {token}'}
)
data3 = json.loads(urllib.request.urlopen(req3).read().decode('utf-8'))['data']
print('Assets with colors=白:', data3['total'])
assert data3['total'] > 0, 'Should find assets with basic_color=白'

# 4. Test anonymous media_token access to /api/assets/:fid/image
m_token = item0['mediaToken']
img_url = f'http://127.0.0.1:30001/api/assets/{item0["fid"]}/image?media_token={m_token}'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)
try:
    img_resp = opener.open(img_url)
    code = img_resp.getcode()
except urllib.error.HTTPError as e:
    code = e.code

print('Media token anonymous access HTTP code:', code)
assert code in (200, 302), f'Expected HTTP 200 or 302, got {code}'

# 5. Test rejected without token
unauth_url = f'http://127.0.0.1:30001/api/assets/{item0["fid"]}/image'
try:
    opener.open(unauth_url)
    unauth_code = 200
except urllib.error.HTTPError as e:
    unauth_code = e.code

print('Unauthenticated image access HTTP code:', unauth_code)
assert unauth_code == 401, f'Expected HTTP 401 without auth, got {unauth_code}'

print('🎉 所有服务端实时 API 验证全部通过！')
