import express from 'express'
import { resolve } from 'path'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { networkInterfaces } from 'os'

const __dirname = process.cwd()
const app = express()
const PORT = 8080 // Production PORT

// HTTP 请求访问日志过滤器（精简版，专注监控页面扫码、API 调用和图纸资源的访问）
app.use((req, res, next) => {
  const startTime = Date.now()
  const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
  const ip = rawIp.includes(':') ? rawIp.split(':').pop() : rawIp
  
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const status = res.statusCode
    const color = status >= 400 ? '❌' : (status >= 300 ? '🔄' : '📶')
    
    const decodedUrl = decodeURIComponent(req.url)
    const isCriticalRequest = req.url === '/' || 
                              req.url.startsWith('/?') || 
                              req.url.includes('/api/') || 
                              decodedUrl.includes('/drawings/uploads') || 
                              decodedUrl.includes('/drawings/qrcodes')
                              
    if (isCriticalRequest) {
      console.log(`${color} [HTTP] ${req.method} ${decodedUrl} - Status: ${status} - Client IP: ${ip} - ${duration}ms`)
    }
  })
  next()
})

// 1. Serve packaged static client assets & public folder drawings
app.use(express.static(resolve(__dirname, './dist')))
app.use('/drawings', express.static(resolve(__dirname, './public/drawings')))

// 2. Binary stream file upload endpoint (pure storage, no ODA converter)
// 2. Binary stream file upload endpoint (pure storage, no ODA converter, keeping original name)
app.post('/api/upload', (req, res) => {
  const originalName = req.query.filename || `upload-${Date.now()}.dxf`
  console.log(`📥 [Server] Received upload request: ${originalName}`)
  
  const chunks = []
  
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const buffer = Buffer.concat(chunks)
    const uploadDir = resolve(__dirname, './public/drawings/uploads')
    
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true })
    }
    
    const filePath = resolve(uploadDir, originalName)
    writeFileSync(filePath, buffer)
    
    let sizeStr = 'Unknown'
    try {
      const stats = statSync(filePath)
      sizeStr = `${(stats.size / 1024 / 1024).toFixed(2)} MB`
    } catch (e) {}
    
    console.log(`🟢 [Server] Upload saved successfully: ${originalName} (${sizeStr})`)
    
    const finalUrl = `./drawings/uploads/${encodeURIComponent(originalName)}`
    res.json({ url: finalUrl, originalName: originalName })
  })
})

// 3. Save QR code image endpoint (automatic backup for watermark print)
app.post('/api/save-qrcode', (req, res) => {
  const filename = req.query.filename || `qrcode-${Date.now()}.png`
  const chunks = []
  
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const buffer = Buffer.concat(chunks)
    const qrDir = resolve(__dirname, './public/drawings/qrcodes')
    
    if (!existsSync(qrDir)) {
      mkdirSync(qrDir, { recursive: true })
    }
    
    writeFileSync(resolve(qrDir, filename), buffer)
    console.log(`🟢 [Server] QR Code backup saved: ${filename}`)
    res.json({ success: true })
  })
})

// Utility to get local network IP for mobile device redirection
const getLocalIP = () => {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return 'localhost'
}

const localIP = getLocalIP()

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n=============================================')
  console.log(`🚀 [Server] CAD Viewer Node Backend Started!`)
  console.log(`🌐 Local URL : http://localhost:${PORT}`)
  console.log(`📱 LAN URL   : http://${localIP}:${PORT}`)
  console.log('=============================================\n')
})
