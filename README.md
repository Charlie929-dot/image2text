# 落文

Windows 桌面图片转文字工具。默认使用本地 Tesseract OCR，图片不上传；需要理解照片、界面或空间关系时，可显式切换到 SiliconFlow 视觉模型。桌面版支持全局快捷键，将剪贴板图片识别后粘贴到之前的光标位置。

## Windows 桌面使用

1. 安装并打开落文桌面版。
2. 需要云端视觉时，在窗口顶部“云端视觉”旁填写 API 地址和 API 密钥并保存。API 地址可留空以使用 SiliconFlow 默认地址；密钥使用 Windows 系统安全存储加密。
3. 复制一张图片，切换到要输入文字的应用并点击目标位置。
4. 按 `Ctrl+Shift+O`。落文在后台用本地 OCR 识别剪贴板图片，然后将结果粘贴到原来的光标处。

窗口内也可以拖入图片、粘贴或选择图片。默认“本地 OCR”适合图片文字；切换“云端视觉”会把图片发送给 SiliconFlow 模型生成场景和布局描述。云端模式需要网络及 API key，并可能产生费用。

## 本地开发

需要 Node.js 22 或更高版本。

```powershell
npm install
npm run dev
```

打开终端显示的本地地址。开发网页默认本地 OCR；如需网页云端模式，在启动前设置服务端变量：

```powershell
$env:SILICONFLOW_API_KEY = "你的密钥"
$env:SILICONFLOW_VISION_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct"
npm run dev
```

桌面开发模式需要本机可用的 Electron 二进制，并会自动启动网页开发服务：

```powershell
npm run desktop:dev
```

桌面云端密钥可以在应用内保存；也可通过 `SILICONFLOW_API_KEY` 环境变量提供。`SILICONFLOW_VISION_MODEL` 可覆盖默认模型。若使用 SiliconFlow 兼容代理，可设置 `SILICONFLOW_BASE_URL`。

## 构建

```powershell
npm run typecheck
npm test
npm run build
npm run desktop:win
```

桌面安装包输出到 `release/`。安装时会创建“落文”桌面和开始菜单快捷方式。`npm run build` 保持网站部署使用的 Vercel preset；桌面构建自动切换 Nitro Node server preset。OCR worker、WASM 核心及简体中文/英文精简训练数据在构建时复制到 `public/ocr`，首次构建需安装相应 npm 数据包。运行 OCR 不需要下载模型。

## 网站部署

项目网站使用 Vite、TanStack Start 和 Nitro Vercel preset。导入 GitHub 仓库到 Vercel，使用默认安装和构建配置，并在项目环境变量中配置：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SILICONFLOW_API_KEY` | 使用云端模式时 | SiliconFlow 服务端 API key，不要添加 `VITE_` 前缀 |
| `SILICONFLOW_VISION_MODEL` | 否 | 视觉模型 ID，默认 `Qwen/Qwen2.5-VL-7B-Instruct`；请按账号可用模型调整 |
| `SILICONFLOW_BASE_URL` | 否 | API 兼容入口，默认 `https://api.siliconflow.com/v1` |
| `DATABASE_URL` | 使用生产认证持久化时 | Postgres/Neon 连接串 |

## 识别与隐私

- 本地 OCR 使用 Tesseract.js WASM、`chi_sim` 和 `eng` 训练数据，在当前设备运行；不需要云端 key。
- 本地 OCR 只提取可见文字，不理解照片场景。复杂照片、图表或 UI 截图可手动切换云端视觉模式；这时先做本地 OCR，再把 OCR 原文和图片交给 SiliconFlow，以兼顾场景理解和文字准确度。
- Windows 全局快捷键通过剪贴板图片识别。识别完成后会将文字短暂写入剪贴板并模拟 `Ctrl+V`；剪贴板随后保留识别文本，方便再次粘贴。
- 文稿、模式和历史仅保存在当前浏览器/桌面用户数据中，不会自动跨设备同步。

## 技术栈

React、TypeScript、Vite、TanStack Start、Tesseract.js、Electron、SiliconFlow OpenAI-compatible Chat Completions API。
