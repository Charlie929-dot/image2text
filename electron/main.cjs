const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, safeStorage } = require("electron");
const { execFile, spawn } = require("node:child_process");
const https = require("node:https");
const { promisify } = require("node:util");
const { HttpsProxyAgent } = require("https-proxy-agent");
const path = require("node:path");

const execFileAsync = promisify(execFile);
const HOTKEY = "CommandOrControl+Shift+O";
let mainWindow;
let appServer;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readCloudKey() {
  if (process.env.SILICONFLOW_API_KEY) return process.env.SILICONFLOW_API_KEY;
  try {
    const stored = JSON.parse(require("node:fs").readFileSync(settingsPath(), "utf8"));
    return safeStorage.decryptString(Buffer.from(stored.siliconFlowKey, "base64"));
  } catch {
    return "";
  }
}

function targetUrl() {
  return process.env.LUOWEN_DEV_URL || `http://127.0.0.1:${app.isPackaged ? 3789 : 8080}`;
}

async function startAppServer() {
  if (process.env.LUOWEN_DEV_URL) return;
  if (app.isPackaged) {
    const serverEntry = path.join(process.resourcesPath, "server-output", "server", "index.mjs");
    appServer = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: "3789",
        NODE_PATH: [path.join(app.getAppPath(), "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
      },
      cwd: path.join(process.resourcesPath, "server-output"),
      stdio: "ignore",
    });
  } else {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    appServer = spawn(npm, ["run", "dev"], { cwd: path.join(__dirname, ".."), stdio: "ignore", shell: true });
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(targetUrl());
      if (response.ok) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("落文本地服务未能启动");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 740,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.loadURL(targetUrl());
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

app.whenReady().then(() => {
  return startAppServer();
}).then(() => {
  createWindow();
  globalShortcut.register(HOTKEY, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      mainWindow.webContents.send("luowen:hotkey-status", "剪贴板里没有图片");
      return;
    }
    mainWindow.webContents.send("luowen:hotkey-ocr", image.toDataURL());
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

ipcMain.handle("luowen:paste-result", async (_event, text) => {
  if (typeof text !== "string" || text.length > 20000) throw new Error("无效的识别结果");
  clipboard.writeText(text);
  await new Promise((resolve) => setTimeout(resolve, 160));
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
  ]);
  return true;
});

ipcMain.handle("luowen:cloud-settings", () => ({
  enabled: Boolean(readCloudKey()),
  baseUrl: (() => {
    try {
      return JSON.parse(require("node:fs").readFileSync(settingsPath(), "utf8")).siliconFlowBaseUrl || "";
    } catch {
      return "";
    }
  })(),
  model: process.env.SILICONFLOW_VISION_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct",
}));

ipcMain.handle("luowen:set-cloud-settings", async (_event, input) => {
  const key = input?.key;
  const baseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim().replace(/\/$/, "") : "";
  if (typeof key !== "string" || key.length > 500) throw new Error("API key 格式无效");
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error("API 地址必须以 http:// 或 https:// 开头");
  if (key.trim() && !safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法安全保存 API key");
  const fs = require("node:fs/promises");
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  let siliconFlowKey = "";
  try {
    siliconFlowKey = JSON.parse(await fs.readFile(settingsPath(), "utf8")).siliconFlowKey || "";
  } catch {
    // First save creates the settings file.
  }
  if (key.trim()) siliconFlowKey = safeStorage.encryptString(key.trim()).toString("base64");
  await fs.writeFile(settingsPath(), JSON.stringify({ siliconFlowKey, siliconFlowBaseUrl: baseUrl }), { mode: 0o600 });
  return { enabled: Boolean(key.trim() || readCloudKey()), baseUrl };
});

ipcMain.handle("luowen:cloud-vision", async (_event, input) => {
  const apiKey = readCloudKey();
  if (!apiKey) throw new Error("尚未配置 SILICONFLOW_API_KEY");
  if (!input || typeof input.imageDataUrl !== "string" || input.imageDataUrl.length > 2_600_000) {
    throw new Error("图片无效或过大");
  }
  const model = process.env.SILICONFLOW_VISION_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct";
  let savedBaseUrl = "";
  try {
    savedBaseUrl = JSON.parse(require("node:fs").readFileSync(settingsPath(), "utf8")).siliconFlowBaseUrl || "";
  } catch {
    // Use the default endpoint until one is configured.
  }
  const baseUrl = (savedBaseUrl || process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.com/v1").replace(/\/$/, "");
  const response = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 1400,
      temperature: 0.1,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: input.imageDataUrl } },
        { type: "text", text: `忠实描述图片中的物体、场景、界面布局和空间关系。不要猜测、分析或给建议。下方本地 OCR 结果用于校对图片文字和数字，请优先原样保留：\n${typeof input.ocrText === "string" ? input.ocrText.slice(0, 8000) : "（无）"}\n只输出描述文本。` },
      ] }],
    });
    const endpoint = new URL(`${baseUrl}/chat/completions`);
    const request = https.request(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      agent: process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined,
      timeout: 90_000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const status = res.statusCode || 0;
        const result = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) return reject(new Error(`SiliconFlow 请求失败（${status}）`));
        try { resolve(JSON.parse(result)); } catch { reject(new Error("SiliconFlow 返回格式无效")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("SiliconFlow 请求超时")));
    request.on("error", reject);
    request.end(body);
  });
  const text = response.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("视觉模型没有返回描述");
  return text.trim().slice(0, 12000);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("will-quit", () => appServer?.kill());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
