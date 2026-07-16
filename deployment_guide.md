# 内网服务器部署指南 (基于 Node.js 方案一)

本指南介绍如何在**完全无法访问外网的纯内网服务器**上，部署 CAD 查看及图纸上传服务，并妥善管理图纸、二维码备份与字体库，防止日常网页更新时覆盖用户数据。

---

## 1. 📂 极简部署文件结构

由于我们已在编译阶段将第三方依赖项（如 `express` 等）全部打包压缩进了一个**单一的主文件**中，因此在内网服务器的运行目录下，**100% 不需要包含任何 `node_modules` 文件夹和 `package.json` 配置文件**。

最终部署在内网服务器（如 `/app/cad-viewer`）上的目录结构仅为：

```
/app/cad-viewer
├── dist/                # 网页代码区：仅存放前端网页编译成品（日常网页更新仅覆盖此目录）
├── server.cjs           # 生产服务单文件：已内置全部依赖，直接运行（日常服务代码更新覆盖此文件）
└── public/              # 数据持久化区：存放用户上传的文件和字体（日常更新千万不要覆盖此目录！）
    └── drawings/
        ├── fonts/       # 字体库存放处（已在打包阶段为您自动预置常用字体）
        ├── qrcodes/     # 服务器自动生成并备份保存的带水印图纸二维码图片（日常请勿删除）
        └── uploads/     # 用户上传的 CAD 原始图纸保存位置
```

*   **物理隔离原理**：
    `server.cjs` 启动后，网页路由指向同级 `./dist`，而图纸/字体路由指向外部 of `./public/drawings`。这确保了前端网页代码的迭代覆盖，绝不会触碰到用户上传的任何图纸资产。

---

## 2. 🟢 Node.js 环境安装与下载

由于您的内网服务器无法访问外网，请提前在有网的电脑上下载安装包，再通过 U 盘或内网传输工具拷贝到服务器上。

### 2.1 官方下载链接 (推荐 Node.js 20 或 22 LTS 长期支持版)
*   **官方 Prebuilt 下载页**：[Node.js 官方下载](https://nodejs.org/en/download/prebuilt-binaries)
*   **直接下载链接**：
    *   **Windows (x64 安装包)**：[Node.js 22 Windows Installer (.msi)](https://nodejs.org/dist/v22.2.0/node-v22.2.0-x64.msi)
    *   **Linux (x64 二进制压缩包)**：[Node.js 22 Linux Binary (.tar.xz)](https://nodejs.org/dist/v22.2.0/node-v22.2.0-linux-x64.tar.xz)

---

### 2.2 💡 极简绿色免安装运行方法 (针对纯内网 Linux/Windows，强烈推荐)
如果您的内网服务器不允许/不方便运行安装程序，Node.js 支持**免安装解压直接运行**：

#### Windows 免安装方法：
1. 下载 **Windows 二进制 Zip 包**：[Node.js Windows Binary (.zip)](https://nodejs.org/dist/v22.2.0/node-v22.2.0-win-x64.zip) 并解压。
2. 拷贝至内网服务器任意路径（如 `D:\nodejs\`）。
3. 在部署目录下，直接使用解压出来的可执行程序运行服务，无需配置环境变量：
   ```cmd
   D:\nodejs\node.exe server.cjs
   ```

#### Linux 免安装方法：
1. 下载 **Linux 二进制压缩包 (.tar.xz)** 并拷贝到内网服务器。
2. 解压文件：
   ```bash
   tar -xvf node-v22.2.0-linux-x64.tar.xz -C /opt/
   ```
3. 在部署目录下直接执行服务：
   ```bash
   /opt/node-v22.2.0-linux-x64/bin/node server.cjs
   ```

---

## 3. 🚀 部署与更新步骤

### 步骤一：在开发机上一键编译并收集产物
在您当前开发电脑的项目根目录下运行：
```bash
pnpm --filter @mlightcad/cad-viewer-qrcode build:release
```
这会自动将前端网页打包（并自动剪裁掉 dist 内的冗余 fonts 资源），并将 `server.js` 后端连同全部依赖，用 `esbuild` 自动编译成单一的 `server.cjs` 文件，一并输出到根目录下的 `release/` 文件夹中。

### 步骤二：首次部署（拷贝所有文件）
将整个 `release/` 文件夹整体拷贝到内网服务器的目标路径下。

### 步骤三：一键启动服务器 (零依赖安装)
无需进行任何 `npm install`。直接使用 node 运行主文件。

> [!IMPORTANT]
> **工作目录（Cwd）约束限制**：
> 后端服务使用 `process.cwd()` 定位静态资源目录 `dist` 和数据持久化盘 `public`。因此，在启动服务前，**终端的当前工作路径必须先切换到 `server.cjs` 所在的同级部署目录下**！
> 如果在其他目录下直接以绝对/相对路径运行（如在根目录直接跑 `node release/server.cjs`），会导致 Express 找不到 `./dist`，导致网页访问全部报 **404 Not Found**。

*   **有全局 node 环境时**：
    ```bash
    # 必须先 cd 进入部署文件夹中
    cd /app/cad-viewer
    node server.cjs
    ```
*   **使用免安装绿色 node 时**（以解压到上级目录，在 Windows CMD 中为例）：
    ```cmd
    # 必须先进入部署目录
    cd F:\cad-viewer\release
    ..\node-v22.2.0-win-x64\node server.cjs
    ```

---

## 🔁 日常前端/后端代码更新与升级（关键防数据丢失操作）

当您在开发机上修改了网页界面，或者修改了后端接收接口，需要同步到内网服务器时：
1.  在开发机重新运行 `pnpm --filter @mlightcad/cad-viewer-qrcode build:release`。
    > [!IMPORTANT]
    > **字体写保护机制**：最新的编译管道已彻底移除了将开发机字体反向覆盖到 release 的命令。这意味着不论您在开发机上如何编译升级，您存放在内网服务器 `release/public/drawings/fonts/` 目录下的全套离线字库资产都将受到 100% 绝对物理隔离和写保护，永远不会被覆盖误写！
2.  **仅将新的 `dist/` 目录和 `server.cjs` 文件**拷贝并覆盖服务器上的旧文件。
3.  **【重要】不要删除或覆盖服务器上的 `public/` 文件夹**。
    *   因为用户下载的全套字体都在 `public/drawings/fonts/` 下，上传的图纸在 `public/drawings/uploads/` 下，二维码在 `public/drawings/qrcodes/` 下。

---

## 💡 4. 本地离线字体服务配置常识
由于底层 CAD 渲染核心在加载字体文件时，会自动在传入的 `baseUrl` 后面拼接 `/fonts/` 子级路径，例如：
*   `${BASE_URL}fonts/fonts.json`
*   `${BASE_URL}fonts/hztxt.shx`

因此，前端 `App.vue` 里的 `BASE_URL` 已经统一设为了 `'./drawings/'`（相对于托管服务器根路径的父级目录），而不是直接设为 `'./drawings/fonts/'`。这样配置在请求时刚好对应服务器物理路径 `release/public/drawings/fonts/`，确保中文兜底字体能正确 200 加载，避免文字显示空白。
