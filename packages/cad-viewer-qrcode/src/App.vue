<template>
  <div id="app-root">
    <!-- Upload screen when no drawing is open -->
    <div v-if="!showViewer" class="upload-screen">
      <FileUpload
        @file-select="handleFileSelect"
        @new-drawing="handleNewDrawing"
      />
    </div>

    <!-- CAD viewer when a file is selected or a new drawing is created -->
    <div v-else>
      <MlCadViewer
        locale="en"
        :local-file="store.selectedFile ?? undefined"
        :url="safeDrawingUrl ? appendTimestamp(safeDrawingUrl) : undefined"
        :mode="selectedMode"
        :use-main-thread-draw="useMainThreadDraw"
        :draw-no-plot-layers="drawNoPlotLayers"
        :progressive-rendering="progressiveRendering"
        :open-view-mode="openViewMode"
        @create="onViewerCreate"
        :base-url="BASE_URL"
      />

      <!-- Share QR Code Button -->
      <div v-if="store.drawingUrl" class="qr-share-container">
        <el-button type="primary" :icon="Share" @click="showQrDialog = true">
          分享二维码 (Share QR Code)
        </el-button>
      </div>

      <!-- QR Code Dialog -->
      <el-dialog
        v-model="showQrDialog"
        title="扫码在手机端查看 (Scan to View on Mobile)"
        width="340px"
        align-center
        @open="generateQrCode"
      >
        <div class="qr-dialog-content">
          <div v-if="qrCodeDataUrl" class="qr-image-wrapper" style="text-align: center;">
            <img :src="qrCodeDataUrl" alt="QR Code" class="qr-image" style="border: 1px solid #ddd; border-radius: 4px; max-width: 240px;" />
          </div>
          <div v-else class="qr-loading">Generating...</div>
          <p class="qr-tip">Ensure your mobile device is connected to the same LAN (Wi-Fi) to view this drawing.</p>
          <div class="qr-link-copy" style="display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap;">
            <el-input :model-value="shareUrl" readonly size="small" style="width: 100%;">
              <template #append>
                <el-button @click="copyShareLink">Copy</el-button>
              </template>
            </el-input>
            <el-button type="primary" size="small" style="width: 100%; margin-left: 0; margin-top: 8px;" @click="downloadQrCode">
              下载二维码图片
            </el-button>
          </div>
        </div>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
// import { AcApSettingManager } from '@mlightcad/cad-simple-viewer'
import { Share } from '@element-plus/icons-vue'
import {
  AcApDocManager,
  AcApOpenViewMode,
  AcEdCommandStack,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer'
import { MlCadViewer } from '@mlightcad/cad-viewer'
import { log } from '@mlightcad/data-model'
import { ElButton, ElDialog, ElInput, ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import { computed, nextTick, ref, onMounted } from 'vue'

import { AcApQuitCmd } from './commands'
import FileUpload from './components/FileUpload.vue'
import { initializeLocale } from './locale'
import { store } from './store'

const initialize = () => {
  initializeLocale()
  if (import.meta.env.DEV) {
    ;(
      window as Window & { AcApDocManager?: typeof AcApDocManager }
    ).AcApDocManager = AcApDocManager
  }
  const register = AcApDocManager.instance.commandManager
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'quit',
    'quit',
    new AcApQuitCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'exit',
    'exit',
    new AcApQuitCmd()
  )
}

// Decide whether to show command line vertical toolbar at the right side,
// performance stats, coordinates in status bar, etc.
// AcApSettingManager.instance.isShowCommandLine = false
// AcApSettingManager.instance.isShowToolbar = false
// AcApSettingManager.instance.isShowStats = false
// AcApSettingManager.instance.isShowCoordinate = false

const BASE_URL = './drawings/'

const showViewer = computed(
  () => store.selectedFile != null || store.drawingUrl != null || store.isNewDrawing
)

const selectedMode = ref<AcEdOpenMode>(AcEdOpenMode.Write)
const useMainThreadDraw = ref(false)
const drawNoPlotLayers = ref(false)
const progressiveRendering = ref(false)
const openViewMode = ref<AcApOpenViewMode | undefined>(undefined)

const showQrDialog = ref(false)
const qrCodeDataUrl = ref('')
const serverIP = ref('')

const safeDrawingUrl = computed(() => {
  const url = store.drawingUrl
  if (!url) return url
  
  // 1. 如果是简化的相对路径
  if (url.startsWith('uploads/') || url.startsWith('uploads_converted/')) {
    const parts = url.split('/')
    const encodedParts = parts.map(p => encodeURIComponent(decodeURIComponent(p)))
    return './drawings/' + encodedParts.join('/')
  }
  
  // 2. 兼容原有的绝对 URL
  const uploadsIdx = url.indexOf('/drawings/uploads/')
  if (uploadsIdx !== -1) {
    const prefix = url.substring(0, uploadsIdx + '/drawings/uploads/'.length)
    const filename = url.substring(uploadsIdx + '/drawings/uploads/'.length)
    // 兼容历史老二维码：老二维码里由于 URL 传输，空格可能会被变成 + 号，这里把 filename 里的 + 号还原回空格
    const decodedFilename = decodeURIComponent(filename).replace(/\+/g, ' ')
    return prefix + encodeURIComponent(decodedFilename)
  }
  const convertedIdx = url.indexOf('/drawings/uploads_converted/')
  if (convertedIdx !== -1) {
    const prefix = url.substring(0, convertedIdx + '/drawings/uploads_converted/'.length)
    const filename = url.substring(convertedIdx + '/drawings/uploads_converted/'.length)
    // 同理还原空格
    const decodedFilename = decodeURIComponent(filename).replace(/\+/g, ' ')
    return prefix + encodeURIComponent(decodedFilename)
  }
  return url
})

const shareUrl = computed(() => {
  if (!store.drawingUrl) return ''
  
  // 1. 从 store.drawingUrl 提取相对路径
  let relativePath = store.drawingUrl
  const drawingsIdx = relativePath.indexOf('/drawings/')
  if (drawingsIdx !== -1) {
    relativePath = relativePath.substring(drawingsIdx + '/drawings/'.length)
  } else if (relativePath.startsWith('./drawings/')) {
    relativePath = relativePath.substring('./drawings/'.length)
  }
  
  // 确保是解码后的明文相对路径
  const decodedRelativePath = decodeURIComponent(relativePath)
  
  // 2. 确定主机名 (Host)
  const host = (serverIP.value && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? `${serverIP.value}:${window.location.port || '8080'}`
    : window.location.host
    
  // 3. 拼接分享绝对地址
  const baseUrl = `${window.location.protocol}//${host}${window.location.pathname}`
  
  // 4. 构建分享 URL
  const url = new URL(baseUrl)
  url.searchParams.set('drawing', decodedRelativePath)
  
  const displayName = store.originalFileName || (store.selectedFile?.name || '')
  if (displayName) {
    url.searchParams.set('name', displayName)
  }
  return url.href
})

const generateQrCode = async () => {
  try {
    const rawQr = await QRCode.toDataURL(shareUrl.value, {
      width: 200,
      margin: 2
    })
    const fileName = store.originalFileName || (store.selectedFile?.name || 'drawing')

    // Bake filename directly into the QR code PNG image canvas
    qrCodeDataUrl.value = await generateCombinedQrCode(rawQr, fileName)

    if (qrCodeDataUrl.value) {
      autoSaveQrCodeToServer(qrCodeDataUrl.value, fileName)
    }
  } catch (err) {
    log.error('Failed to generate QR code:', err)
  }
}

const generateCombinedQrCode = (qrBase64: string, text: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = qrBase64
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 280
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(qrBase64)
        return
      }

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 20, 10, 200, 200)

      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif'
      ctx.fillStyle = '#333333'
      ctx.textAlign = 'center'
      
      const textToDraw = `图纸：${text}`
      const maxWidth = 220
      const words = textToDraw.split('')
      let line = ''
      const lines = []

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n]
        const metrics = ctx.measureText(testLine)
        if (metrics.width > maxWidth && n > 0) {
          lines.push(line)
          line = words[n]
        } else {
          line = testLine
        }
      }
      lines.push(line)

      const drawLines = lines.slice(0, 2)
      let y = 232
      for (let i = 0; i < drawLines.length; i++) {
        ctx.fillText(drawLines[i], 120, y)
        y += 18
      }

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      resolve(qrBase64)
    }
  })
}

const copyShareLink = async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl.value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl.value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!successful) throw new Error('execCommand failed')
    }
    ElMessage({
      message: 'Share link copied to clipboard!',
      type: 'success'
    })
  } catch (err) {
    ElMessage({
      message: 'Failed to copy link',
      type: 'error'
    })
  }
}

const appendTimestamp = (url: string) => {
  try {
    const u = new URL(url, window.location.href)
    u.searchParams.set('t', Date.now().toString())
    return u.href
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()
  }
}

const downloadQrCode = () => {
  if (!qrCodeDataUrl.value) return
  const fileName = store.originalFileName || (store.selectedFile?.name || 'drawing')
  const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName
  
  const link = document.createElement('a')
  link.href = qrCodeDataUrl.value
  link.download = `${baseName}-二维码.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  ElMessage.success('二维码图片下载成功！')
}

const autoSaveQrCodeToServer = async (base64Data: string, originalFileName: string) => {
  try {
    const response = await fetch(base64Data)
    const blob = await response.blob()
    
    const baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName
    const qrFileName = `${baseName}-二维码.png`
    
    await fetch(`/api/save-qrcode?filename=${encodeURIComponent(qrFileName)}`, {
      method: 'POST',
      body: blob,
      headers: {
        'Content-Type': 'image/png'
      }
    })
    console.log('[AutoSave] 二维码已自动保存备份至服务器！')
  } catch (err) {
    console.error('[AutoSave] 自动保存二维码失败:', err)
  }
}

onMounted(async () => {
  try {
    const res = await fetch('/api/server-info')
    if (res.ok) {
      const data = await res.json()
      serverIP.value = data.localIP
    }
  } catch (e) {
    console.warn('Failed to fetch server info:', e)
  }

  const params = new URLSearchParams(window.location.search)
  const urlParam = params.get('drawing')
  const nameParam = params.get('name')
  if (urlParam) {
    store.drawingUrl = decodeURIComponent(urlParam)
    store.selectedFile = null
    store.isNewDrawing = false
  }
  if (nameParam) {
    store.originalFileName = decodeURIComponent(nameParam)
  }
})

const createNewDrawing = async () => {
  const success = await AcApDocManager.instance.newDocument({
    mode: selectedMode.value,
    drawNoPlotLayers: drawNoPlotLayers.value,
    progressiveRendering: progressiveRendering.value,
    ...(openViewMode.value != null ? { openViewMode: openViewMode.value } : {})
  })
  if (!success) {
    log.error('Failed to create new drawing')
  }
}

const onViewerCreate = async () => {
  initialize()
  if (store.isNewDrawing) {
    await nextTick()
    await createNewDrawing()
  }
}

const applyOpenOptions = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  selectedMode.value = mode
  useMainThreadDraw.value = mainThreadDraw
  drawNoPlotLayers.value = showNoPlotLayers
  progressiveRendering.value = enableProgressiveRendering
  openViewMode.value = viewMode
}

// Handle file selection from upload component
const handleFileSelect = (
  file: File,
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  store.isNewDrawing = false
  store.selectedFile = file
  store.drawingUrl = null
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode
  )
}

const handleNewDrawing = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined
) => {
  store.isNewDrawing = true
  store.selectedFile = null
  store.drawingUrl = null
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode
  )
}
</script>

<style scoped>
#app-root {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: #0f172a; /* Premium dark background */
}

.upload-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1000;
  pointer-events: auto; /* Allow clicks on upload screen */
  display: flex;
  justify-content: center;
  align-items: center;
}

.qr-share-container {
  position: fixed;
  right: 40px;
  top: 20px;
  z-index: 1000;
}

.qr-dialog-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-image-wrapper {
  background: white;
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.qr-image {
  display: block;
  width: 200px;
  height: 200px;
}

.qr-tip {
  font-size: 12px;
  color: #64748b;
  text-align: center;
  margin: 0;
  max-width: 260px;
}

.qr-link-copy {
  width: 100%;
  margin-top: 4px;
}
</style>
