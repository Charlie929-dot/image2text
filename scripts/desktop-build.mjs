import { spawn } from "node:child_process";
import { exitStatusFromChild, isMainModule } from "./with-app-env.mjs";

if (isMainModule(import.meta.url)) {
  process.env.LUOWEN_TARGET = "desktop";
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run via npm run desktop:win");
  const child = spawn(process.execPath, [npmCli, "run", "build"], { stdio: "inherit", env: process.env });
  child.on("error", (error) => { console.error(error); process.exit(1); });
  child.on("exit", (code, signal) => process.exit(exitStatusFromChild(code, signal)));
}
