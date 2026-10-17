<template>
  <div class="h5-page detail-page">
    <header class="detail-header">
      <button class="h5-btn ghost" @click="onBack">← 返回</button>
      <span class="detail-title">素材详情</span>
      <button class="h5-btn primary" @click="onDownload" :disabled="downloading">
        {{ downloading ? '下载中…' : '下载' }}
      </button>
      <button class="h5-btn ghost" @click="onEdit">✂ 精准编辑</button>
    </header>

    <main class="detail-main" v-if="item">
      <div v-if="loadingMedia" class="img-loading">正在加载预览…</div>
      <img
        v-else-if="item.isMusic"
        class="detail-img audio-ph"
        :src="audioPlaceholder"
        alt="audio"
      />
      <img
        v-else
        class="detail-img"
        :src="imgUrl"
        @error="onImgErr"
        alt="preview"
      />
      <audio v-if="item.isMusic && fileUrl" class="audio-ctrl" :src="fileUrl" controls></audio>

      <div class="meta h5-card">
        <h3>{{ item.fileName || item.fid }}</h3>
        <p class="dim mono">{{ item.fid }}</p>
        <p class="dim">
          {{ typeText }} · {{ item.width }}×{{ item.height }}{{ sizeText ? ' · ' + sizeText : '' }}
        </p>
        <p class="tags" v-if="tagList.length">
          <span v-for="t in tagList" :key="t" class="h5-chip">{{ t }}</span>
        </p>
      </div>
    </main>
    <p class="dim pad" v-else-if="!loading">
      素材不存在或已被移除。<span v-if="errorText" class="err">{{ errorText }}</span>
    </p>
    <p class="dim pad" v-else>加载中…</p>
  </div>
</template>

<script>
import { fetchDetail, mediaUrl, sessionValid } from '../../service/ViewerApi'
import { mapServerDetail } from '../../common/assetMap'
import { authMediaUrl, getMediaObjectUrl, fetchMediaBlob } from '../../service/WebDownload'
import { ensureServerUrl } from '../../service/ServerResolve'
import { H5 } from '../h5-theme'

export default {
  data() {
    return {
      fid: '',
      item: null,
      loading: true,
      loadingMedia: true,
      downloading: false,
      errorText: '',
      theme: H5,
      imgUrl: '',
      fileUrl: '',
    }
  },
  onLoad(q) {
    this.fid = q.fid || ''
    this.load()
  },
  computed: {
    typeText() {
      const it = this.item
      if (!it) return ''
      if (it.isMusic) return 'audio'
      if (it.isVideo) return 'video'
      if (it.isModel) return '3D'
      return 'image'
    },
    sizeText() {
      return this.item?.size ? (this.item.size / 1024 / 1024).toFixed(1) + ' MB' : ''
    },
    tagList() {
      const t = this.item?.tagsText
      return t ? String(t).split('·').map((s) => s.trim()).filter(Boolean) : []
    },
    audioPlaceholder() {
      return (
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect fill="#F1F5F9" width="800" height="400"/><text x="400" y="210" text-anchor="middle" fill="#64748B" font-size="36">音频素材</text></svg>'
        )
      )
    },
  },
  methods: {
    async load() {
      if (!sessionValid()) {
        uni.reLaunch({ url: '/pages-h5/login/login' })
        return
      }
      this.loading = true
      this.errorText = ''
      try {
        await ensureServerUrl()
        const raw = await fetchDetail(this.fid)
        // 详情接口是包装结构，必须走 mapServerDetail
        this.item = mapServerDetail(raw || {})
        await this.loadPreview()
      } catch (e) {
        console.warn('[detail] load failed', e)
        this.errorText = (e && e.message) || ''
        this.item = null
      } finally {
        this.loading = false
      }
    },
    async loadPreview() {
      this.loadingMedia = true
      try {
        const it = this.item
        if (!it) return
        if (it.isMusic) {
          this.fileUrl = mediaUrl(this.fid, 0, false)
          this.imgUrl = this.audioPlaceholder
          return
        }
        // H5：Bearer + Blob，避免裸相对路径无鉴权
        const url = it.isVideo
          ? authMediaUrl(this.fid, { kind: 'poster' })
          : authMediaUrl(this.fid, {
              derivativeId: it.mainDerivativeId || 0,
              kind: 'image',
            })
        this.imgUrl = await getMediaObjectUrl('detail:' + this.fid, url)
        if (it.isVideo) {
          this.fileUrl = mediaUrl(this.fid, 0, false)
        }
      } catch (e) {
        console.warn('[detail] preview failed', e)
        // 回退 query token 地址
        try {
          this.imgUrl = mediaUrl(this.fid, this.item?.mainDerivativeId || 0, false)
        } catch (e2) {
          this.errorText = '预览加载失败：' + ((e && e.message) || '')
        }
      } finally {
        this.loadingMedia = false
      }
    },
    onImgErr() {
      // 再试一次 token URL
      this.imgUrl = mediaUrl(this.fid, this.item?.mainDerivativeId || 0, false)
    },
    onBack() {
      history.back()
    },
    onEdit() {
      uni.navigateTo({ url: '/pages-h5/edit/edit?fid=' + encodeURIComponent(this.fid) })
    },
    async onDownload() {
      if (this.downloading) return
      this.downloading = true
      try {
        const url = authMediaUrl(this.fid, {
          derivativeId: this.item?.mainDerivativeId || 0,
          kind: this.item?.isVideo ? 'file' : 'image',
          dl: true,
        })
        const blob = await fetchMediaBlob(url)
        const obj = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = obj
        a.download = this.item?.fileName || this.fid
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(obj), 3000)
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '下载失败', icon: 'none' })
      } finally {
        this.downloading = false
      }
    },
  },
}
</script>

<style>
.detail-page {
  min-height: 100vh;
  background: #f8fafc;
}
.detail-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  z-index: 10;
}
.detail-title {
  flex: 1;
  font-weight: 600;
  color: #0f172a;
}
.detail-main {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-img {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}
.img-loading {
  padding: 48px;
  text-align: center;
  color: #64748b;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.meta {
  padding: 16px;
}
.meta h3 {
  margin: 0 0 6px;
  font-size: 16px;
  color: #0f172a;
}
.dim {
  color: #64748b;
  font-size: 13px;
  margin: 4px 0;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.pad {
  padding: 24px 16px;
}
.err {
  color: #dc2626;
}
.audio-ctrl {
  width: 100%;
}
</style>
