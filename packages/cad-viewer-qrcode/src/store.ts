import { reactive } from 'vue'

export const store = reactive<{
  selectedFile: File | null
  drawingUrl: string | null
  originalFileName: string | null
  isNewDrawing: boolean
}>({
  selectedFile: null,
  drawingUrl: null,
  originalFileName: null,
  isNewDrawing: false
})
