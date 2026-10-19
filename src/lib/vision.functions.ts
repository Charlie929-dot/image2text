import { createServerFn } from "@tanstack/react-start";
import type { Lang, Mode } from "@/lib/manuscript";

const MAX_DATA_URL = 2_600_000;

type Payload = {
  dataUrl: string;
  filename: string;
  mode: Mode;
  lang: Lang;
  ocrText?: string;
};

function xmlName(name: string): string {
  const clean = name.replace(/[\r\n\t]+/g, " ").replace(/[<>&"']/g, "").trim();
  return clean.slice(0, 80) || "image";
}

function asMode(value: unknown): Mode {
  return value === "brief" || value === "ocr" ? value : "full";
}

function asLang(value: unknown): Lang {
  return value === "en" ? "en" : "zh";
}

function buildPrompt(mode: Mode, lang: Lang, filename: string, ocrText = ""): string {
  const name = xmlName(filename);
  const langLine =
    lang === "zh"
      ? "Write <scene> and <structure> in Simplified Chinese. Keep <visible_text> verbatim in its original language, script, and casing."
      : "Write <scene> and <structure> in English. Keep <visible_text> verbatim in its original language, script, and casing.";
  const density =
    mode === "brief"
      ? "Be compact: <scene> is at most two sentences. Include <structure> only when layout, UI, or numbers matter; otherwise write 无."
      : mode === "ocr"
        ? "Transcribe only. Put 无 in <scene> and <structure>. Put every visible string in <visible_text>, preserving line breaks. If there is no text, write 无."
        : "Be dense and literal, not chatty. Record objects, counts, colors, and spatial relations a model needs when it cannot see the pixels. Do not invent text that is not visible.";
  return [
    "Convert this image into a textual surrogate another language model can use without the pixels.",
    langLine,
    density,
    ocrText.trim()
      ? `A local OCR pass transcribed the following visible text. Preserve it verbatim and use it to correct small labels and numbers:\n${ocrText.slice(0, 8000)}`
      : "",
    "Output only the XML below. No markdown fences, no preamble, no explanation.",
    `<image name="${name}">`,
    "<scene>...</scene>",
    "<visible_text>",
    "verbatim text with original line breaks, or 无",
    "</visible_text>",
    "<structure>",
    "regions, reading order, tables, charts, and numbers, or 无",
    "</structure>",
    "</image>",
  ].join("\n");
}

function tokenCap(mode: Mode): number {
  if (mode === "brief") return 500;
  if (mode === "ocr") return 1200;
  return 1400;
}

function extractText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const root = body as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.trim()) {
    return root.output_text.trim();
  }
  if (!Array.isArray(root.output)) return "";
  const parts: string[] = [];
  for (const item of root.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    if (message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const chunk = part as Record<string, unknown>;
      if (
        (chunk.type === "output_text" || chunk.type === "text") &&
        typeof chunk.text === "string"
      ) {
        parts.push(chunk.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function cleanSurrogate(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:xml|XML)?\s*/, "").replace(/\s*```$/, "").trim();
  }
  const block = text.match(/<image\b[^>]*>[\s\S]*<\/image>/i);
  return (block ? block[0] : text).trim().slice(0, 12000);
}

type ApiResponse = { status: number; body: string };

async function postResponses(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  baseUrl = "https://api.x.ai/v1/responses",
): Promise<ApiResponse> {
  const https = await import("node:https");
  const payload = JSON.stringify(body);
  const endpoint = new URL(baseUrl);
  const agent = process.env.HTTPS_PROXY ? new (await import("https-proxy-agent")).HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        agent,
        path: endpoint.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    const abort = () => {
      const reason = signal.reason;
      req.destroy(reason instanceof Error ? reason : new Error("Aborted"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    req.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    req.write(payload);
    req.end();
  });
}

function fail(status: number): { ok: false; error: string } {
  if (status === 429) return { ok: false, error: "读得太勤，稍等再拖一张" };
  if (status === 401 || status === 403) return { ok: false, error: "读图服务暂时不可用" };
  return { ok: false, error: "读图没有完成，请再试一次" };
}

export const readImage = createServerFn({ method: "POST" })
  .validator((input: unknown): Payload => {
    if (!input || typeof input !== "object") throw new Error("请求无效");
    const raw = input as Record<string, unknown>;
    const dataUrl = raw.dataUrl;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) {
      throw new Error("只接受 jpg 或 png");
    }
    if (dataUrl.length > MAX_DATA_URL) throw new Error("图片太大，请换一张更小的");
    const filename = typeof raw.filename === "string" ? raw.filename.slice(0, 180) : "图片";
    const ocrText = typeof raw.ocrText === "string" ? raw.ocrText.slice(0, 8000) : "";
    return { dataUrl, filename, mode: asMode(raw.mode), lang: asLang(raw.lang), ocrText };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.SILICONFLOW_API_KEY ?? process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "读图服务还没接上" };
    const siliconFlow = Boolean(process.env.SILICONFLOW_API_KEY);
    const model = siliconFlow
      ? (process.env.SILICONFLOW_VISION_MODEL ?? "Qwen/Qwen2.5-VL-7B-Instruct")
      : "grok-4.7";

    const prompt = buildPrompt(data.mode, data.lang, data.filename, data.ocrText);
    const payload: Record<string, unknown> = siliconFlow
      ? {
          model,
          max_tokens: tokenCap(data.mode),
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: data.dataUrl } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }
      : {
          model,
          store: false,
          max_output_tokens: tokenCap(data.mode),
          reasoning: { effort: "low" },
          input: [
            {
              role: "user",
              content: [
                { type: "input_image", image_url: data.dataUrl, detail: "high" },
                { type: "input_text", text: prompt },
              ],
            },
          ],
        };

    try {
      const signal = AbortSignal.timeout(90_000);
      const endpoint = siliconFlow
        ? `${process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.com/v1"}/chat/completions`
        : "https://api.x.ai/v1/responses";
      let response = await postResponses(apiKey, payload, signal, endpoint);
      if (response.status === 400) {
        if (/reasoning/i.test(response.body)) {
          delete payload.reasoning;
          response = await postResponses(apiKey, payload, signal, endpoint);
        } else {
          console.error("readImage 400");
          return fail(400);
        }
      } else if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        response = await postResponses(apiKey, payload, signal, endpoint);
      }

      if (response.status < 200 || response.status >= 300) {
        console.error("readImage status", response.status);
        return fail(response.status);
      }

      const json: unknown = JSON.parse(response.body);
      const responseBody = siliconFlow
        ? (() => {
            const body = json as { choices?: Array<{ message?: { content?: unknown } }> };
            const content = body.choices?.[0]?.message?.content;
            return typeof content === "string" ? content : "";
          })()
        : extractText(json);
      const text = cleanSurrogate(responseBody);
      if (!text) {
        console.error("readImage empty output");
        return { ok: false as const, error: "没有读出文字，请再试一次" };
      }
      return { ok: true as const, text };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { ok: false as const, error: "读太久了，请再试一次" };
      }
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false as const, error: "读太久了，请再试一次" };
      }
      console.error("readImage failed");
      return { ok: false as const, error: "读图没有完成，请再试一次" };
    }
  });
