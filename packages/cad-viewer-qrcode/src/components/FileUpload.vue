<template>
  <div class="file-upload-container">
    <div class="upload-panel">
      <div class="upload-main">
        <section class="upload-hero">
          <div class="upload-icon">
            <el-icon :size="20">
              <UploadFilled />
            </el-icon>
          </div>
          <div class="upload-hero-text">
            <h1 class="upload-title">Select CAD File to View</h1>
            <p class="upload-subtitle">
              Import DWG or DXF drawings into the viewer
            </p>
          </div>
        </section>

        <div class="upload-actions">
          <button
            v-if="!selectedRawFile"
            type="button"
            class="new-drawing-button"
            @click="handleNewDrawing"
          >
            New Drawing
          </button>

          <p v-if="!selectedRawFile" class="upload-divider" aria-hidden="true">
            <span>or</span>
          </p>

          <el-upload
            v-if="!selectedRawFile"
            class="upload-dropzone"
            drag
            :auto-upload="false"
            accept=".dwg,.dxf"
            :on-change="onFileChange"
            :before-upload="beforeUpload"
            :show-file-list="false"
          >
            <div class="dropzone-content">
              <p class="dropzone-title">
                Drop file or <span class="dropzone-link">browse</span>
              </p>
              <div class="format-tags">
                <span class="format-tag">DWG</span>
                <span class="format-tag">DXF</span>
              </div>
            </div>
          </el-upload>

          <!-- 选中文件后的操作面板 -->
          <div v-else class="file-action-panel">
            <div class="selected-file-info">
              <span class="file-icon">📄</span>
              <span class="file-name" :title="selectedRawFile.name">{{ selectedRawFile.name }}</span>
              <button type="button" class="clear-file-btn" @click="selectedRawFile = null">✕</button>
            </div>
            
            <div class="action-buttons">
              <button
                type="button"
                class="action-btn open-btn"
                @click="handleDirectOpen"
              >
                直接打开 (Open Local)
              </button>
              <button
                type="button"
                class="action-btn share-btn"
                :disabled="isUploading"
                @click="handleUploadAndShare"
              >
                {{ isUploading ? 'Uploading...' : '上传并生成二维码 (Upload & Generate QR)' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section class="settings-section">
        <header class="settings-header">
          <h2 class="settings-title">Open options</h2>
        </header>

        <div class="settings-grid">
          <div class="setting-block setting-block--full">
            <h3 class="setting-label">Initial view</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              aria-label="Initial view"
            >
              <button
                v-for="option in openViewModes"
                :key="option.value"
                type="button"
                class="pill-option"
                :class="{ 'is-active': selectedOpenViewMode === option.value }"
                role="radio"
                :aria-checked="selectedOpenViewMode === option.value"
                :title="option.description"
                @click="selectedOpenViewMode = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="setting-block setting-block--full">
            <h3 class="setting-label">Access mode</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              aria-label="Access mode"
            >
              <button
                v-for="mode in accessModes"
                :key="mode.value"
                type="button"
                class="pill-option"
                :class="{ 'is-active': selectedMode === mode.value }"
                role="radio"
                :aria-checked="selectedMode === mode.value"
                :title="mode.description"
                @click="selectedMode = mode.value"
              >
                {{ mode.label }}
              </button>
            </div>
          </div>

          <div class="setting-block">
            <h3 class="setting-label">Text rendering</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              aria-label="Text rendering"
            >
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': !useMainThreadDraw }"
                role="radio"
                :aria-checked="!useMainThreadDraw"
                title="Faster, more memory"
                @click="useMainThreadDraw = false"
              >
                Worker
              </button>
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': useMainThreadDraw }"
                role="radio"
                :aria-checked="useMainThreadDraw"
                title="Slower, less memory"
                @click="useMainThreadDraw = true"
              >
                Main thread
              </button>
            </div>
          </div>

          <div class="setting-block">
            <h3 class="setting-label">Progressive</h3>
            <div
              class="pill-segment"
              role="radiogroup"
              aria-label="Progressive rendering"
            >
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': progressiveRendering }"
                role="radio"
                :aria-checked="progressiveRendering"
                title="Show geometry while loading"
                @click="progressiveRendering = true"
              >
                Show
              </button>
              <button
                type="button"
                class="pill-option"
                :class="{ 'is-active': !progressiveRendering }"
                role="radio"
                :aria-checked="!progressiveRendering"
                title="Show geometry after fully loaded"
                @click="progressiveRendering = false"
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { UploadFilled } from '@element-plus/icons-vue'
import { AcApOpenViewMode, AcEdOpenMode } from '@mlightcad/cad-simple-viewer'
import { log } from '@mlightcad/data-model'
import type { UploadFile, UploadProps } from 'element-plus'
import { ElIcon, ElUpload, ElMessage } from 'element-plus'
import { ref } from 'vue'
import { store } from '../store'

interface Props {
  onFileSelect: (
    file: File,
    mode: AcEdOpenMode,
    useMainThreadDraw: boolean,
    drawNoPlotLayers: boolean,
    progressiveRendering: boolean,
    openViewMode: AcApOpenViewMode | undefined
  ) => void
  onNewDrawing?: (
    mode: AcEdOpenMode,
    useMainThreadDraw: boolean,
    drawNoPlotLayers: boolean,
    progressiveRendering: boolean,
    openViewMode: AcApOpenViewMode | undefined
  ) => void
}

const props = defineProps<Props>()

type OpenViewModeChoice = 'auto' | AcApOpenViewMode

const selectedMode = ref<AcEdOpenMode>(AcEdOpenMode.Write)
const selectedOpenViewMode = ref<OpenViewModeChoice>('auto')
const useMainThreadDraw = ref(false)
const drawNoPlotLayers = ref(false)
const progressiveRendering = ref(false)

const selectedRawFile = ref<File | null>(null)
const isUploading = ref(false)

const openViewModes = [
  {
    value: 'auto' as const,
    label: 'Auto',
    description: 'Based on access mode'
  },
  {
    value: AcApOpenViewMode.Extents,
    label: 'Extents',
    description: 'Fit drawing'
  },
  {
    value: AcApOpenViewMode.Saved,
    label: 'Saved',
    description: 'AutoCAD saved view'
  }
] as const

const resolveOpenViewMode = (): AcApOpenViewMode | undefined =>
  selectedOpenViewMode.value === 'auto' ? undefined : selectedOpenViewMode.value

const accessModes = [
  {
    value: AcEdOpenMode.Read,
    label: 'Read',
    description: 'View only'
  },
  {
    value: AcEdOpenMode.Review,
    label: 'Review',
    description: 'View & review'
  },
  {
    value: AcEdOpenMode.Write,
    label: 'Write',
    description: 'Full access'
  }
] as const

const onFileChange: UploadProps['onChange'] = (uploadFile: UploadFile) => {
  if (uploadFile.raw && isValidFile(uploadFile.raw)) {
    selectedRawFile.value = uploadFile.raw
  }
}

const handleDirectOpen = () => {
  if (!selectedRawFile.value) return
  
  // 记录原始文件名
  store.originalFileName = selectedRawFile.value.name
  
  props.onFileSelect(
    selectedRawFile.value,
    selectedMode.value,
    useMainThreadDraw.value,
    drawNoPlotLayers.value,
    progressiveRendering.value,
    resolveOpenViewMode()
  )
}

const handleUploadAndShare = async () => {
  if (!selectedRawFile.value) return
  isUploading.value = true
  try {
    const file = selectedRawFile.value
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })

    const response = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: arrayBuffer,
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    })

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`)
    }

    const data = await response.json()
    if (data.url) {
      loadDemoDrawing(data.url, data.originalName)
    } else {
      throw new Error('No url returned from upload API')
    }
  } catch (err) {
    log.error('Failed to upload drawing:', err)
    ElMessage({
      message: 'Failed to upload drawing. Make sure dev server is running.',
      type: 'error'
    })
  } finally {
    isUploading.value = false
  }
}

const handleNewDrawing = () => {
  props.onNewDrawing?.(
    selectedMode.value,
    useMainThreadDraw.value,
    drawNoPlotLayers.value,
    progressiveRendering.value,
    resolveOpenViewMode()
  )
}

const beforeUpload: UploadProps['beforeUpload'] = (rawFile: File) => {
  if (!isValidFile(rawFile)) {
    log.warn('Invalid file type. Please upload DWG or DXF files.')
    return false
  }
  return true
}

const isValidFile = (file: File): boolean => {
  const validExtensions = ['.dwg', '.dxf']
  const fileName = file.name.toLowerCase()
  return validExtensions.some(ext => fileName.endsWith(ext))
}

const loadDemoDrawing = (url: string, originalName?: string) => {
  const currentUrl = new URL(window.location.href)
  
  // Extract relative path (e.g. uploads/file.dxf) from url
  let relativePath = url
  const drawingsIdx = url.indexOf('/drawings/')
  if (drawingsIdx !== -1) {
    relativePath = url.substring(drawingsIdx + '/drawings/'.length)
  } else if (url.startsWith('./drawings/')) {
    relativePath = url.substring('./drawings/'.length)
  }
  
  const decodedPath = decodeURIComponent(relativePath)
  currentUrl.searchParams.set('drawing', decodedPath)
  if (originalName) {
    currentUrl.searchParams.set('name', originalName)
    try {
      localStorage.setItem(`cad_name_${decodedPath}`, originalName)
    } catch {}
  }
  window.location.href = currentUrl.href
}
</script>

<style scoped>
.file-upload-container {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 820px;
  padding: 12px 16px;
  box-sizing: border-box;
}

.upload-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto;
  width: 100%;
  border-radius: 14px;
  background: #ffffff;
  box-shadow:
    0 20px 40px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.upload-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18px 20px;
}

.upload-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.upload-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #5b6fd6 100%);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.28);
}

.upload-hero-text {
  min-width: 0;
}

.upload-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #0f172a;
  line-height: 1.25;
}

.upload-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}

.upload-actions {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.new-drawing-button {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #5b6fd6 100%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(102, 126, 234, 0.26);
  transition:
    transform 0.15s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.new-drawing-button:hover {
  filter: brightness(1.03);
  box-shadow: 0 8px 18px rgba(102, 126, 234, 0.32);
}

.new-drawing-button:active {
  transform: translateY(1px);
}

.upload-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.upload-divider::before,
.upload-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.upload-dropzone {
  width: 100%;
  box-sizing: border-box;
}

.upload-dropzone :deep(.el-upload) {
  width: 100%;
}

.upload-dropzone :deep(.el-upload-dragger) {
  padding: 24px 16px;
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.upload-dropzone :deep(.el-upload-dragger):hover {
  border-color: #667eea;
  background: #f1f5f9;
}

.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.dropzone-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.dropzone-link {
  color: #667eea;
  text-decoration: underline;
  cursor: pointer;
}

.format-tags {
  display: flex;
  gap: 6px;
}

.format-tag {
  padding: 2px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  font-size: 10px;
  font-weight: 700;
  color: #475569;
}

.settings-section {
  padding: 18px 20px;
  background: #f8fafc;
  border-left: 1px solid #e2e8f0;
}

.settings-header {
  margin-bottom: 12px;
}

.settings-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.setting-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-block--full {
  grid-column: span 2;
}

.setting-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pill-segment {
  display: flex;
  border-radius: 8px;
  background: #e2e8f0;
  padding: 2px;
  width: 100%;
  box-sizing: border-box;
}

.pill-option {
  flex: 1;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-option:hover {
  color: #334155;
}

.pill-option.is-active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}

/* 选中文件后的操作面板 */
.file-action-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
}

.selected-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
}

.file-icon {
  font-size: 18px;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-file-btn {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  transition: color 0.2s;
}

.clear-file-btn:hover {
  color: #ef4444;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.open-btn {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
}

.open-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.share-btn {
  background: linear-gradient(135deg, #667eea 0%, #5b6fd6 100%);
  color: #ffffff;
  box-shadow: 0 4px 10px rgba(102, 126, 234, 0.2);
}

.share-btn:hover {
  filter: brightness(1.03);
  box-shadow: 0 6px 14px rgba(102, 126, 234, 0.28);
}

.share-btn:disabled {
  background: #cbd5e1;
  color: #94a3b8;
  box-shadow: none;
  cursor: not-allowed;
}
</style>
