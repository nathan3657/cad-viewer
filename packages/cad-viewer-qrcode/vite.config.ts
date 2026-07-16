import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { networkInterfaces } from 'os'
import { Alias, defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import svgLoader from 'vite-svg-loader'
import { visualizer } from 'rollup-plugin-visualizer'
import vue from '@vitejs/plugin-vue'
import { exampleRollupOutput } from '../vite-config/pluginRollupOutput'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VIEWER_RUNTIME_SRC = '../cad-html-plugin/dist/viewer-runtime.iife.js'
const LOCAL_DATA_MODEL_LIB = resolve(
  __dirname,
  '../../../realdwg-web/packages/data-model/lib'
)
const LOCAL_DATA_MODEL_ENTRY = resolve(LOCAL_DATA_MODEL_LIB, 'index.js')

function useLocalDataModel(mode: string): boolean {
  if (mode === 'local-data-model') {
    return true
  }
  const flag = process.env.CAD_VIEWER_USE_LOCAL_DATA_MODEL
  return flag === '1' || flag?.toLowerCase() === 'true'
}

// 本地开发模拟前端上传与二维码自动保存中间件（纯存盘，无 ODA 转换）
const uploadPlugin = {
  name: 'vite-plugin-cad-upload',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url && req.url.startsWith('/api/upload') && req.method === 'POST') {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
        const filename = urlObj.searchParams.get('filename') || 'uploaded.dxf'
        
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const uploadDir = resolve(__dirname, './public/drawings/uploads')
          if (!existsSync(uploadDir)) {
            mkdirSync(uploadDir, { recursive: true })
          }
          const filePath = resolve(uploadDir, filename)
          writeFileSync(filePath, buffer)
          
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          })
          res.end(JSON.stringify({ url: `./drawings/uploads/${encodeURIComponent(filename)}`, originalName: filename }))
        })
        return
      }
      if (req.url && req.url.startsWith('/api/save-qrcode') && req.method === 'POST') {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
        const filename = urlObj.searchParams.get('filename') || 'qrcode.png'
        
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const qrDir = resolve(__dirname, './public/drawings/qrcodes')
          if (!existsSync(qrDir)) {
            mkdirSync(qrDir, { recursive: true })
          }
          writeFileSync(resolve(qrDir, filename), buffer)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          })
          res.end(JSON.stringify({ success: true }))
        })
        return
      }
      if (req.url && req.url.startsWith('/api/server-info') && req.method === 'GET') {
        const nets = networkInterfaces()
        let localIP = 'localhost'
        for (const name of Object.keys(nets)) {
          for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
              localIP = net.address
              break
            }
          }
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        })
        res.end(JSON.stringify({ localIP, port: server.config.server.port || 5173 }))
        return
      }
      next()
    })
  }
}

export default defineConfig(({ command, mode }) => {
  if (!existsSync(resolve(__dirname, VIEWER_RUNTIME_SRC))) {
    throw new Error(
      'viewer-runtime.iife.js not found. Build @mlightcad/cad-html-plugin before cad-viewer-qrcode.'
    )
  }
  const aliases: Alias[] = []
  const devSourcePackages = [
    'cad-svg-plugin',
    'three-renderer',
    'cad-simple-viewer',
    'cad-viewer'
  ]
  const linkLocalDataModel =
    command === 'serve' &&
    useLocalDataModel(mode) &&
    existsSync(LOCAL_DATA_MODEL_ENTRY)
  if (command === 'serve') {
    aliases.push({
      find: /^@mlightcad\/(cad-svg-plugin|three-renderer|cad-simple-viewer|cad-viewer)$/,
      replacement: resolve(__dirname, '../$1/src')
    })
    if (linkLocalDataModel) {
      aliases.push({
        find: '@mlightcad/data-model',
        replacement: LOCAL_DATA_MODEL_LIB
      })
    } else if (useLocalDataModel(mode) && !existsSync(LOCAL_DATA_MODEL_ENTRY)) {
      console.warn(
        '[cad-viewer-qrcode] Local data-model alias requested but not found at:',
        LOCAL_DATA_MODEL_ENTRY
      )
    }
  }

  const plugins = [
    vue(),
    svgLoader(),
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/cad-simple-viewer/dist/*-worker.js',
          dest: 'assets'
        },
        {
          src: VIEWER_RUNTIME_SRC,
          dest: 'assets'
        }
      ]
    }),
    uploadPlugin
  ]

  // Add conditional plugins
  if (mode === 'analyze') {
    plugins.push(visualizer())
  }

  return {
    base: './',
    resolve: {
      alias: aliases
    },
    optimizeDeps: {
      force: command === 'serve', // Force re-optimization in dev mode to fix stale cache issues
      exclude:
        command === 'serve'
          ? [
              ...devSourcePackages.map(name => `@mlightcad/${name}`),
              ...(linkLocalDataModel ? ['@mlightcad/data-model'] : [])
            ]
          : []
    },
    build: {
      outDir: 'dist',
      modulePreload: false,
      minify: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        output: exampleRollupOutput
      }
    },
    plugins: plugins
  }
})
