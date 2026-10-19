# 落文

把图片转成大模型可读的文字，并插入文稿光标处。支持图片拖入、粘贴和多选；提供详述、短述、仅文字三种模式，以及中文/英文输出。文稿、模式和最近处理记录保存在当前浏览器本地。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

打开终端显示的本地地址。首次处理图片前，需要设置 xAI API 密钥：

```bash
# macOS / Linux
export XAI_API_KEY="your-xai-api-key"
npm run dev
```

PowerShell：

```powershell
$env:XAI_API_KEY = "your-xai-api-key"
npm run dev
```

开发服务器通过项目脚本启动，以便正确加载项目环境配置。生产构建和类型检查：

```bash
npm run typecheck
npm run build
npm run preview
```

## 部署到 Vercel

仓库使用 Vite + TanStack Start，并在 `vite.config.ts` 中配置了 Nitro 的 Vercel preset。

1. 在 Vercel 中导入 `Charlie929-dot/image2text` 仓库。
2. 保持框架预设为 Vite/Other，并使用仓库的默认构建设置。构建命令为 `npm run build`；不要覆盖仓库中的 `vercel.json` 安装配置。
3. 在 Vercel 项目设置的 Environment Variables 中添加 `XAI_API_KEY`，并选择需要生效的环境。
4. 部署。每次推送到连接的分支会触发新部署。

`XAI_API_KEY` 必须只配置为服务端环境变量，不要使用 `VITE_` 前缀，也不要提交到仓库。没有该密钥时，应用界面仍可打开，但读图会提示服务未配置。

如需在生产环境持久化认证数据，再配置 Postgres 兼容的 `DATABASE_URL`（例如 Neon）；构建时项目会自动执行数据库迁移。未设置时使用进程内 PGLite，适合本地运行，不适合作为生产持久化存储。若启用登录/OAuth，还需按认证提供方配置相应部署环境变量。

## 使用方法

1. 打开应用，在文稿中点击要插入内容的位置。
2. 将图片拖入窗口、粘贴剪贴板图片，或点击“选择图片”（支持多选）。
3. 选择“详述”“短述”或“仅文字”，并选择中文或英文输出。
4. 识别结果会插入光标位置并尝试复制到剪贴板；右侧“近稿”可再次插入最近结果。

图片在浏览器端缩放并转换后发送到服务端，再由服务端调用 xAI API。单张原图最大 20 MB；浏览器本地保存的文稿和历史不会同步到其他设备。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行测试 |
| `npm run lint` | ESLint 检查 |
| `npm run build` | 构建生产版本并执行数据库迁移（若配置了 `DATABASE_URL`） |
| `npm run preview` | 本地预览生产构建 |

## 技术栈

React、TypeScript、Vite、TanStack Start、Tailwind CSS、Nitro、PGLite/Postgres、xAI Grok Responses API。
