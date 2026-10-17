"""
设备端真实状态探针（只读）
"""
import subprocess, os, sys, re, json

ADB = r'C:\Users\lrp\Downloads\HBuilderX\plugins\launcher-tools\tools\adbs\adb.exe'
SERIAL = '127.0.0.1:21503'

def adb(*args, timeout=40, binary=False):
    r = subprocess.run([ADB, '-s', SERIAL] + list(args),
                       capture_output=True, timeout=timeout)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')

def sh(cmd, **kw):
    return adb('shell', cmd, **kw)

print('=' * 62)
print('1. 已安装的 lrp.* 包')
print('=' * 62)
pkgs = sh('pm list packages | grep lrp')
print(pkgs.strip() or '(无)')

print()
print('=' * 62)
print('2. 各包的版本 / 安装时间 / ABI')
print('=' * 62)
for line in pkgs.strip().splitlines():
    name = line.strip().replace('package:', '')
    if not name:
        continue
    d = sh(f'dumpsys package {name}')
    ver = re.search(r'versionName=(\S+)', d)
    vc = re.search(r'versionCode=(\d+)', d)
    ut = re.search(r'firstInstallTime=(.+)', d)
    lt = re.search(r'lastUpdateTime=(.+)', d)
    tgt = re.search(r'targetSdk=(\d+)', d)
    src = path = None
    pm = sh(f'pm path {name}').strip().splitlines()
    if pm:
        path = pm[0].replace('package:', '')
    print(f'  {name}')
    print(f'    versionName={ver.group(1) if ver else "?"}  versionCode={vc.group(1) if vc else "?"}'
          f'  targetSdk={tgt.group(1) if tgt else "?"}')
    print(f'    firstInstall={ut.group(1).strip() if ut else "?"}')
    print(f'    lastUpdate  ={lt.group(1).strip() if lt else "?"}')
    print(f'    apk={path}')

print()
print('=' * 62)
print('3. 当前前台 Activity')
print('=' * 62)
print(sh('dumpsys activity activities | grep -E "mResumedActivity|mFocusedWindow" | head -5').strip())

print()
print('=' * 62)
print('4. 设备上 app-service.js 的真实标识符（关键！）')
print('=' * 62)
for line in pkgs.strip().splitlines():
    name = line.strip().replace('package:', '')
    if not name:
        continue
    # uni-app 的 wgt 资源在 /data/data/<pkg>/apps/<appid>/www 或 files 下
    print(f'--- {name} ---')
    for base in [f'/data/data/{name}', f'/sdcard/Android/data/{name}']:
        r = sh(f'ls -la {base} 2>/dev/null | head -20')
        if r.strip() and 'No such' not in r:
            print(f'  [{base}]')
            print('\n'.join('    ' + x for x in r.strip().splitlines()[:12]))
    # 尝试找已安装 wgt
    r = sh(f'find /data/data/{name} -name "*.wgt" 2>/dev/null | head -10')
    if r.strip():
        print('  已安装 wgt:')
        print('\n'.join('    ' + x for x in r.strip().splitlines()))
