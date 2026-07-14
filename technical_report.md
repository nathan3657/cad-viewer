# CAD查看器内网迁移与上传分享功能开发 ── 深度技术白皮书

本报告是针对本项目进行内网隔离部署、大文件流上传、防缓存活码分享及全套 CAD 字体本地自托管方案的**深度技术白皮书**。报告中详细记录了每一处代码级的插桩、构建流程重构的底层逻辑、以及生产环境部署的运维细节，供后续代码审计、安全 Review 和系统重构参考。

---

## 1. 📂 架构基础与项目拓扑 (System Architecture)

本项目采用现代大前端的 **Monorepo（单体多包）** 拓扑结构进行管理，构建链基于 `pnpm workspaces` 配合 `Nx` 进行多任务管道化编译。

### 1.1 核心包分工 (Monorepo Packages)
```
/packages
├── three-renderer          # 核心图形渲染管线：深度封装 Three.js 材质、着色器与 WebGL 合批绘制
├── cad-simple-viewer       # 核心业务逻辑层：处理 DXF/DWG 实体解析、视口变换（矩阵平移缩放）、CAD 捕捉及命令栈
├── cad-viewer              # 客户端 UI 外壳层：基于 Vue 3 + Element Plus 的完整的 CAD 桌面应用级交互界面
└── cad-viewer-example      # 宿主集成应用（Vue 3 Demo）：本次改造落地的宿主站点，用于承载全栈上传与分享闭环
```
在这种架构下，底层模块是高内聚、无框架绑定的（纯 TS 实现），而 UI 壳层通过 Vue 3 进行驱动。

---

## 🎯 2. 核心业务需求与技术难点 (Requirements & Challenges)

在将本系统迁移至**完全物理隔离、禁止连接互联网**的内网服务器环境时，项目面临以下几项硬性技术挑战：

1.  **静态资源隔离与升级防覆盖**：用户上传的图纸以及字体库属于**数据资产（Data Assets）**，而网页生成的 HTML/JS 属于**代码成品（Code Assets）**。在后续系统频繁升级覆盖网页代码时，必须保证外部图纸在磁盘上得到 100% 物理保护，不被误删。
2.  **局域网安全上下文兼容（HTTP 复制链接）**：现代浏览器出于安全考虑，只在 HTTPS 环境下暴露 `navigator.clipboard` 接口。但在内网测试中，用户往往使用 `http://192.168.x.x:8080` 的纯 IP HTTP 访问。必须保证在不配置 SSL 证书的情况下，复制链接按钮绝对可用。
3.  **图纸实时覆盖与缓存消除**：为了保持现场张贴的物理二维码永不更换，当后台用同名文件覆盖更新时，必须强行让手机浏览器重新拉取物理图纸，阻断浏览器对大二进制文件的三级缓存（Memory, Disk, ServiceWorker）。
4.  **字体库的完整离线化与防崩溃**：渲染核心在遇到缺字时会默认向公网发起 `fonts/fonts.json` 及 `.shx` 请求，若网络不通会触发未捕获的 Promise 异常，导致前端视口完全卡死白屏。必须在内网彻底闭环解决字体依赖。

---

## 🛠️ 3. 深度技术实现与代码级插桩 (Code-Level Implementation)

### 3.1 前端核心插桩解析

#### A. 二进制流图纸上传 (`[FileUpload.vue](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/src/components/FileUpload.vue)`)
为了不依赖大型表单库并保证极速的文件流上传，前端在用户选中 `.dxf` 或 `.dwg` 文件时，直接读取其二进制 Blob，通过裸 fetch 流的形式发送给后端，实现流式数据传输：
```typescript
const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  isLoading.value = true;
  try {
    // 1. 直接发送二进制流，不使用 FormData，减轻内存负载
    const response = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file, // 裸 Blob 流传输
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    });

    if (!response.ok) throw new Error('Upload failed');
    const result = await response.json();

    // 2. 将服务器返回的相对图纸地址写入全局 store，激活渲染并拉起分享弹窗
    store.drawingUrl = result.url;
    store.selectedFile = file;
    emit('upload-success', result.url);
  } catch (err: any) {
    ElMessage.error(err.message || '上传失败');
  } finally {
    isLoading.value = false;
  }
};
```

#### B. 兼容性复制兜底算法 (`[App.vue](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/src/App.vue)`)
为了解决内网纯 HTTP 下 `navigator.clipboard` 报错的问题，我们增加了一套基于临时 `textarea` 的老旧 API 降级算法：
```typescript
const copyShareLink = async () => {
  try {
    // 1. 优先检测现代 Clipboard API（仅在 HTTPS/localhost 下可用）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl.value);
    } else {
      // 2. 降级方案：创建不可见临时文本框，选中并执行系统复制命令
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl.value;
      textarea.style.position = 'fixed'; // 防止引起页面滚动
      textarea.style.opacity = '0';      // 保持视觉不可见
      document.body.appendChild(textarea);
      textarea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (!successful) throw new Error('execCommand failed');
    }
    ElMessage.success('分享链接已成功复制到剪贴板！');
  } catch (err) {
    ElMessage.error('复制链接失败，请手动选择复制');
  }
};
```

#### C. 水印合成与一键下载保存二维码
为了方便用户将生成的二维码下载打印、整理或张贴在物理设备现场，并且避免批量下载/打印后无法区分，我们设计了 **Canvas 图像文字合成机制**：
*   **图像合成原理**：在前端获取二维码 Base64 后，利用 HTML5 Canvas 动态创建一张 `240x280` 像素的白底画布。在 `(20, 10)` 坐标处绘制 `200x200` 大小的二维码，然后在正下方绘制加粗的 `图纸：[文件名]` 标识文本。如果文件名过长，算法会自动分行绘制（限制最大 2 行）。
*   **一键手动下载**：用户点击前端“下载二维码图片”按钮，将合成后的新 Canvas 转换为 Base64 PNG，触发下载。
*   **后端全自动保存**：在前端合成出带有图纸文字的二维码图片的瞬间，会自动发送 `POST /api/save-qrcode?filename=...` 请求。后端 Express 接收该二进制流，并将其**全自动静默备份保存**至服务器的 `public/drawings/qrcodes/` 目录下。
*   **最终效果**：无论是在网页弹窗里、下载的 PNG 中，还是服务器自动备份的目录里，**所有的二维码图片画面底部都已自带了“图纸：文件名”的清晰文字，彻底杜绝了打印后无法核实的问题。**
```typescript
const downloadQrCode = () => {
  if (!qrCodeDataUrl.value) return
  const fileName = store.drawingUrl 
    ? getFileNameFromUrl(store.drawingUrl) 
    : (store.selectedFile?.name || 'drawing')
  const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName
  
  const link = document.createElement('a')
  link.href = qrCodeDataUrl.value
  link.download = `${baseName}-二维码.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
```

#### D. 文件名解析、防缓存与 URL 二次防截断编码
当用户把图纸渲染进 `MlCadViewer` 时，前端自动加上随机毫秒时间戳来打破浏览器的 Disk Cache：
```vue
<MlCadViewer
  :url="safeDrawingUrl ? appendTimestamp(safeDrawingUrl) : undefined"
/>
```

##### 1. 为什么需要 `safeDrawingUrl` 双重 URL 编码防御？
*   **现象**：当用户上传含有 **`#`**、空格、`&` 等在 URL 中具有特殊语义的字符的图纸（如 `104 送水泵站5#~7#控制图.dwg`）时，如果直接用明文路径，浏览器会将 `#` 解释为 URL 的哈希片段（Fragment Identifier），在发送 HTTP 网络请求时自动将 `#` 之后的内容全部截断，导致服务器报 404！
*   **二次解码陷阱**：前端从浏览器地址栏通过 `urlParams.get('drawing')` 接收参数时，浏览器会自动对其进行一次 URL 解码，将安全的 `%23` 变回了明文 `#`。如果不加干预直接传给底层，网络请求依然会被截断！
*   **对策**：在 `App.vue` 中设计了 `safeDrawingUrl` 拦截层，先进行 `decode` 还原为最纯粹的中文明文，随后强制对文件名部分单独运行 `encodeURIComponent`，确保所有特殊的 `#` 在网络层都会被转义为 `%23`，在不改变磁盘上中文名可视性的前提下，彻底解决了 404 截断问题：

```typescript
const safeDrawingUrl = computed(() => {
  const url = store.drawingUrl
  if (!url) return url
  const uploadsIdx = url.indexOf('/drawings/uploads/')
  if (uploadsIdx !== -1) {
    const prefix = url.substring(0, uploadsIdx + '/drawings/uploads/'.length)
    const filename = url.substring(uploadsIdx + '/drawings/uploads/'.length)
    return prefix + encodeURIComponent(decodeURIComponent(filename))
  }
  const convertedIdx = url.indexOf('/drawings/uploads_converted/')
  if (convertedIdx !== -1) {
    const prefix = url.substring(0, convertedIdx + '/drawings/uploads_converted/'.length)
    const filename = url.substring(convertedIdx + '/drawings/uploads_converted/'.length)
    return prefix + encodeURIComponent(decodeURIComponent(filename))
  }
  return url
})

// 动态附加时间戳，防止同名覆盖时加载浏览器缓存
const appendTimestamp = (url: string) => {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set('t', Date.now().toString());
    return u.href;
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  }
};
```

// 2. 字符解码与文件名解析，用于展示在二维码下方
const getFileNameFromUrl = (url: string) => {
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    return parts[parts.length - 1];
  } catch {
    return 'CAD图纸';
  }
};
```

---

### 3.2 后端设计与打包融合白皮书 (Bundling Internals)

#### A. 为什么选用 `process.cwd()` 替代 `__dirname`？
在打包单文件 Node 程序时，源码中如果使用了 `__dirname`，打包工具会强制将其硬编码为编译时的路径（例如本地开发机的绝对路径），导致拷入服务器运行时无法正确寻找同级目录。
我们改用 **`process.cwd()`（当前工作目录）**。当服务启动在 `release` 目录下时，`process.cwd()` 返回的就是 `F:\cad-viewer\release`，保证了静态目录静态托管的完全相对化与高移植性：
```javascript
// server.js 核心逻辑
const __dirname = process.cwd(); // 绝对相对路径，随着命令执行路径动态迁移
app.use(express.static(resolve(__dirname, './dist'))); // 托管网页成品
app.use('/drawings', express.static(resolve(__dirname, './public/drawings'))); // 托管图纸与字体
```

#### B. 为什么必须打包成 CommonJS (`server.cjs`) 格式？
`express` 中依赖了诸如 `debug`、`send` 等多年前编写的古老 CommonJS 依赖库。这些库内部含有非静态的 CommonJS 原生 `require()`（例如根据运行环境动态执行 `require('tty')`）。
*   **如果打包成 ESM (`.mjs`)**：ESM 语法不支持动态 CommonJS 的 `require`，`esbuild` 会被迫生成报错垫片，导致运行到该代码段时服务直接崩溃。
*   **打包成 CJS (`.cjs`)**：`esbuild` 会把我们所有的模块拉直编译为 CommonJS 格式。对于 Node.js 内置的原生模块（如 `tty`, `fs`, `path`, `os` 等），它会自动作为 external 外部加载保留，在 Node.js 中以原生的 `require` 完美运行，100% 兼容。

---

### 3.3 构建流程精细化 (Build pipeline)

我们在 `[package.json](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/package.json)` 中编写了极其精细的构建打包管道：
```json
"build:release": "pnpm build && rimraf dist/drawings && mkdir -p ../../release/public/drawings/uploads ../../release/public/drawings/fonts ../../release/public/drawings/qrcodes && rimraf ../../release/dist && cp -r dist ../../release/dist && esbuild server.js --bundle --platform=node --target=node20 --outfile=../../release/server.cjs && (cp public/drawings/*.dxf ../../release/public/drawings/ 2>/dev/null || true)"
```

#### 管道步骤逐条分析 (Step-by-Step)：
1.  **`pnpm build`**：利用 Vite 编译前端代码，此时 Vite 默认会把 `public/drawings`（包括里面的 10MB+ 字体库）全量拷入 `dist/` 下。
2.  **`rimraf dist/drawings`**：**【关键瘦身】** 立刻强行在编译目录里把整个 `drawings` 目录删除，使 `dist/` 中仅剩下纯净网页代码，**包体积直接暴瘦 10MB+**。
3.  **`mkdir -p ../../release/public/drawings/uploads ...`**：在根目录下创建 release 数据存放区。由于使用的是 `mkdir -p`，如果服务器已经存在该目录（内含用户之前上传的图纸、全套字体），**它绝对不会将其删除或重写，提供了完美的写保护。**
4.  **`rimraf ../../release/dist && cp -r dist ../../release/dist`**：清空并只覆盖更新前端网页成品，彻底隔离数据区。
5.  **`esbuild server.js --bundle --platform=node ...`**：调用 `esbuild` 快速把后端代码连同 express 合并混淆，打包输出单文件 `server.cjs`（1.1MB）。
6.  **物理字体库绝对写保护**：最新的编译管道已**彻底拿掉了在构建时拷贝本地开发机字体到生产包的命令**。这样部署和更新系统代码时，**100% 对内网服务器上的物理字体资产进行了写保护**，绝不会因为日常更新而反向写坏或覆盖用户在服务器上下好的丰富字库。
7.  **`(cp public/drawings/*.dxf ... || true)`**：非阻塞、安全地尝试拷贝示例 `.dxf` 文件，出错自动忽略，避免流程卡死。

---

## 📊 4. 技术结果与包构成 (Build Results)

最终在 `release/` 生成的干净包中，只剩下 3 样东西，彻底消灭了冗余文件：

| 文件夹/文件名 | 作用 | 体积大小 | 是否是冗余文件 | 日常升级覆盖规则 |
| :--- | :--- | :--- | :--- | :--- |
| **`dist/`** | 纯净的前端打包网页代码 | ~4 MB | 否 (核心网页) | **直接删除旧的并覆盖** |
| **`server.cjs`** | 包含了 Express 的单文件后端 | ~1.1 MB | 否 (运行核心) | **直接覆盖** |
| **`public/`** | 存放字体（85款）与用户上传图纸的持久化层 | ~12 MB | 否 (数据层) | **【重要】严禁覆盖或删除** |

---

## 💡 5. 使用、Review 与运维升级指南 (Operational Guide)

### 5.1 生产环境极简启动 (Windows Server)
1.  解压免安装的 Node.js 绿色版至目录，例如：`F:\cad-viewer\node-v22.2.0-win-x64\`。
2.  双击进入 `F:\cad-viewer\release\` 目录。
3.  在文件夹顶部的地址栏中，输入 `cmd` 并回车以唤醒已经定位好路径的命令行窗口。
4.  在窗口中执行启动命令即可运行：
    ```cmd
    ..\node-v22.2.0-win-x64\node server.cjs
    ```

---

### 5.2 局域网网络设置与安全组配置 (LAN Setup)
为保证手机能正常扫码，必须进行以下网络配置：
1.  **处于同一局域网**：手机连接的 Wi-Fi 与内网服务器必须在同一个局域网内（可以通过 ping IP 地址进行测试）。
2.  **Windows 防火墙入站规则开放**：
    在 Windows 服务器上，由于我们使用的是 `8080` 端口，必须开启防火墙的入站访问：
    *   打开“控制面板” -> “系统和安全” -> “Windows Defender 防火墙” -> “高级设置”。
    *   点击“入站规则” -> “新建规则” -> 选择“端口” -> 输入特定本地端口 `8080` -> 选择“允许连接”并命名保存。

---

### 5.3 后续 Review 与代码升级指南 (Developer Guide)

#### 场景一：修改了上传组件或前端 UI 界面
1.  在开发机上修改：`[App.vue](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/src/App.vue)` 或 `[FileUpload.vue](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/src/components/FileUpload.vue)`。
2.  在开发机项目根目录下运行一键打包：
    ```bash
    pnpm --filter @mlightcad/cad-viewer-example build:release
    ```
3.  打包完成后，**只将** `release/dist/` 文件夹拷过去覆盖服务器上的旧 `dist/`，重启服务器或不重启网页即生效（数据盘绝对不会丢失）。

#### 场景二：修改了后端接收代码或端口
1.  在开发机上修改：`[server.js](file:///Users/nathanchiu/project/cad-viewer/packages/cad-viewer-example/server.js)`。
2.  运行一键打包 `pnpm --filter @mlightcad/cad-viewer-example build:release`。
3.  将新生成的单个 `release/server.cjs` 拷贝并覆盖服务器上的旧文件，在 CMD 命令行中按 `Ctrl + C` 中断旧服务，重新输入 `..\node-v22.2.0-win-x64\node server.cjs` 启动即可。

#### 场景三：遇到了缺失字体的图纸（显示问号）
1.  无需任何重新编译或代码开发，您只需要找到对应的 `.shx` 字体文件。
2.  直接将该字体丢入服务器上的 `release/public/drawings/fonts/` 目录下。
3.  手机重新扫码或刷新，网页即可自动识别并绘制出汉字文字，免维护效果极佳。
