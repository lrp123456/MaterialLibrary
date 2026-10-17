"""
定位设备上真正生效的 www 资源，并逐个查标识符。
"""
import subprocess, os, re

ADB = r'C:\Users\lrp\Downloads\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe'
SERIAL = '127.0.0.1:21503'
PKG = 'lrp.aibum'

def sh(cmd, timeout=60):
    r = subprocess.run([ADB, '-s', SERIAL, 'shell', cmd],
                       capture_output=True, timeout=timeout)
    return r.stdout.decode('utf-8', 'replace')

print('=' * 64)
print('A. 设备上所有 app-service.js / www 目录')
print('=' * 64)
for base in [f'/data/data/{PKG}', f'/sdcard/Android/data/{PKG}']:
    r = sh(f'find {base} -name "app-service.js" 2>/dev/null')
    print(f'[{base}]')
    print(r.strip() or '  (none)')
    r2 = sh(f'find {base} -type d -name "www" 2>/dev/null')
    if r2.strip():
        print('  www dirs:')
        for x in r2.strip().splitlines():
            print('   ', x)

print()
print('=' * 64)
print('B. apps/ 目录（uni-app 存放已安装 wgt 的位置）')
print('=' * 64)
r = sh(f'ls -laR /sdcard/Android/data/{PKG}/apps 2>/dev/null | head -60')
print(r)

print()
print('=' * 64)
print('C. manifest.json（wgt 版本信息）')
print('=' * 64)
r = sh(f'find /sdcard/Android/data/{PKG} -name "manifest.json" 2>/dev/null')
for line in r.strip().splitlines():
    if not line:
        continue
    print(f'--- {line} ---')
    print(sh(f'cat "{line}" 2>/dev/null | head -40'))

print()
print('=' * 64)
print('D. 前台页面（logcat 抓 uni-app 路由）')
print('=' * 64)
sh('logcat -c')
sh('am force-stop ' + PKG)
import time
time.sleep(1)
sh(f'monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
time.sleep(6)
log = sh('logcat -d -v time 2>/dev/null | grep -iE "weex|jsengine|dcloud|uni-app|Pandora|app-service" | tail -40')
print(log if log.strip() else '(logcat 无相关输出)')
