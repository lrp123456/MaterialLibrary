// 冒烟：验证共用层模块在 mock uni 下可加载且候选地址正确
const path = require('path')

globalThis.uni = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  request: () => {},
}

const base = path.resolve(__dirname, '../src')
const toUrl = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/')

async function main() {
  const Constants = await import(toUrl(path.join(base, 'common/Constants.js')))
  console.log('Constants OK', {
    default: Constants.DEFAULT_SERVER_URL,
    schemes: Constants.SERVER_SCHEME_OPTIONS.map((s) => s.key),
  })

  const storeMod = await import(toUrl(path.join(base, 'service/SyncStateStore.js')))
  const { store } = storeMod
  console.log('store.getServerScheme()', store.getServerScheme())
  console.log('store.getServerCustomUrl()', JSON.stringify(store.getServerCustomUrl()))
  console.log('store.getServerUrl()', store.getServerUrl())

  const resolve = await import(toUrl(path.join(base, 'service/ServerResolve.js')))
  console.log('build auto', resolve.buildCandidateUrls({ scheme: 'auto', customUrl: '' }))
  console.log('build lan', resolve.buildCandidateUrls({ scheme: 'lan', customUrl: '' }))
  console.log('build custom', resolve.buildCandidateUrls({ scheme: 'auto', customUrl: 'http://10.0.0.8:30001/' }))
  console.log('currentServerUrl()', resolve.currentServerUrl())

  const assetMap = await import(toUrl(path.join(base, 'common/assetMap.js')))
  const row = {
    fid: 'test1',
    file_name: 'a.jpg',
    width: 100,
    height: 100,
    kind: 'image',
    status: 'ready',
    tags: [],
  }
  const mapped = assetMap.mapServerAsset(row)
  console.log('mapServerAsset OK', { fid: mapped.fid, imgUrl: mapped.imgUrl, thumbSrc: mapped.thumbSrc })
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
