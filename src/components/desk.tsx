import { useEffect, useRef, useState } from "react";
import { fileToJpeg, isMaybeImage } from "@/lib/image";
import {
  caretLabel,
  excerpt,
  insertAt,
  markerLine,
  newId,
  removeMarker,
  replaceMarker,
  type Lang,
  type Mode,
} from "@/lib/manuscript";
import { readImage } from "@/lib/vision.functions";

const DRAFT_KEY = "luowen.draft";
const MODE_KEY = "luowen.mode";
const LANG_KEY = "luowen.lang";
const HIST_KEY = "luowen.history";

const MODES: { id: Mode; label: string }[] = [
  { id: "full", label: "详述" },
  { id: "brief", label: "短述" },
  { id: "ocr", label: "仅文字" },
];

const LANGS: { id: Lang; label: string }[] = [
  { id: "zh", label: "中文" },
  { id: "en", label: "EN" },
];

type HistItem = {
  id: string;
  name: string;
  thumb: string;
  text: string;
  at: number;
};

type Job = {
  marker: string;
  file: File;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";

function isHistItem(value: unknown): value is HistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HistItem>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.text === "string" &&
    typeof item.thumb === "string"
  );
}

function saveHistory(items: HistItem[]) {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(items));
  } catch {
    try {
      const slim = items.map((item) => ({ ...item, thumb: "" }));
      localStorage.setItem(HIST_KEY, JSON.stringify(slim));
    } catch {
      /* quota */
    }
  }
}

export function Desk() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("full");
  const [lang, setLang] = useState<Lang>("zh");
  const [history, setHistory] = useState<HistItem[]>([]);
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armClear, setArmClear] = useState(false);
  const [lastBlock, setLastBlock] = useState("");
  const [loaded, setLoaded] = useState(false);

  const textRef = useRef("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef({ start: 0, end: 0 });
  const modeRef = useRef<Mode>("full");
  const langRef = useRef<Lang>("zh");
  const depthRef = useRef(0);
  const textDirty = useRef(false);
  const modeDirty = useRef(false);
  const langDirty = useRef(false);
  const queueRef = useRef<Job[]>([]);
  const activeRef = useRef(0);
  const runJobRef = useRef<(job: Job) => Promise<void>>(async () => {});
  const pumpRef = useRef<() => void>(() => {});
  const enqueueRef = useRef<(files: File[]) => void>(() => {});

  modeRef.current = mode;
  langRef.current = lang;

  function commit(next: string, caretPos: number | null) {
    textDirty.current = true;
    textRef.current = next;
    setText(next);
    if (caretPos != null) {
      const pos = { start: caretPos, end: caretPos };
      caretRef.current = pos;
      setCaret(pos);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(caretPos, caretPos);
      });
    }
    try {
      localStorage.setItem(DRAFT_KEY, next);
    } catch {
      /* quota */
    }
  }

  function remember(name: string, thumb: string, block: string) {
    const item: HistItem = {
      id: newId(),
      name: name || "图片",
      thumb,
      text: block,
      at: Date.now(),
    };
    setHistory((prev) => [item, ...prev].slice(0, 12));
    setLastBlock(block);
  }

  runJobRef.current = async (job) => {
    try {
      const prepared = await fileToJpeg(job.file);
      const result = await readImage({
        data: {
          dataUrl: prepared.dataUrl,
          filename: job.file.name || "图片",
          mode: modeRef.current,
          lang: langRef.current,
        },
      });
      if (!result.ok) {
        const removed = removeMarker(textRef.current, job.marker);
        commit(removed.text, removed.caret);
        setStatus(result.error);
        return;
      }
      const block = result.text.endsWith("\n") ? result.text : `${result.text}\n`;
      const applied = replaceMarker(textRef.current, job.marker, block);
      commit(applied.text, applied.caret);
      remember(job.file.name || "图片", prepared.thumb, result.text);
      setStatus("已落在光标处");
      try {
        await navigator.clipboard.writeText(result.text);
        setStatus("已落在光标处，并复制到剪贴板");
      } catch {
        /* clipboard may be blocked after the drop gesture ends */
      }
    } catch (error) {
      const removed = removeMarker(textRef.current, job.marker);
      commit(removed.text, removed.caret);
      setStatus(error instanceof Error ? error.message : "没有读成");
    }
  };

  pumpRef.current = () => {
    while (activeRef.current < 2 && queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (!job) return;
      activeRef.current += 1;
      setBusy(activeRef.current);
      void runJobRef.current(job).finally(() => {
        activeRef.current -= 1;
        setBusy(activeRef.current);
        pumpRef.current();
      });
    }
  };

  enqueueRef.current = (files) => {
    const images = files.filter(isMaybeImage);
    if (!images.length) {
      setStatus("没有可读的图片");
      return;
    }
    const el = taRef.current;
    let cursor = el?.selectionStart ?? caretRef.current.start;
    let selEnd = el?.selectionEnd ?? caretRef.current.end;
    let next = textRef.current;
    const jobs: Job[] = [];
    images.forEach((file, index) => {
      const marker = markerLine(newId(), file.name || "图片");
      const applied = insertAt(next, index === 0 ? cursor : cursor, index === 0 ? selEnd : cursor, marker);
      next = applied.text;
      cursor = applied.caret;
      selEnd = cursor;
      jobs.push({ marker, file });
    });
    commit(next, cursor);
    queueRef.current.push(...jobs);
    setStatus(images.length > 1 ? `正在读 ${images.length} 张` : "正在读这张图");
    pumpRef.current();
  };

  useEffect(() => {
    try {
      if (!textDirty.current) {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (typeof draft === "string" && draft.length > 0) {
          textRef.current = draft;
          setText(draft);
        }
      }
      const savedMode = localStorage.getItem(MODE_KEY);
      if (
        !modeDirty.current &&
        (savedMode === "full" || savedMode === "brief" || savedMode === "ocr")
      ) {
        setMode(savedMode);
      }
      const savedLang = localStorage.getItem(LANG_KEY);
      if (!langDirty.current && (savedLang === "zh" || savedLang === "en")) setLang(savedLang);
      const raw = localStorage.getItem(HIST_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const items = parsed.filter(isHistItem).slice(0, 12);
          setHistory(items);
          const first = items[0];
          if (first) setLastBlock(first.text);
        }
      }
    } catch {
      /* ignore broken storage */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [loaded, mode, lang]);

  useEffect(() => {
    if (!loaded) return;
    saveHistory(history);
  }, [loaded, history]);

  useEffect(() => {
    if (!armClear) return;
    const timer = window.setTimeout(() => setArmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armClear]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.some(isMaybeImage)) return;
      event.preventDefault();
      enqueueRef.current(files);
    };
    const blockNavigate = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", blockNavigate);
    window.addEventListener("drop", blockNavigate);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", blockNavigate);
      window.removeEventListener("drop", blockNavigate);
    };
  }, []);

  function syncCaret(el: HTMLTextAreaElement) {
    const pos = { start: el.selectionStart, end: el.selectionEnd };
    caretRef.current = pos;
    setCaret(pos);
  }

  function insertBlock(block: string) {
    const el = taRef.current;
    const start = el?.selectionStart ?? caretRef.current.start;
    const end = el?.selectionEnd ?? caretRef.current.end;
    const body = block.endsWith("\n") ? block : `${block}\n`;
    const applied = insertAt(textRef.current, start, end, body.trimEnd());
    commit(applied.text, applied.caret);
    setStatus("已插回光标处");
  }

  async function copyText(value: string, empty: string) {
    if (!value.trim()) {
      setStatus(empty);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus("已复制");
    } catch {
      setStatus("复制失败，请在文稿里手动选择");
    }
  }

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden bg-walnut text-cream"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depthRef.current = 0;
        setDragging(false);
        enqueueRef.current(Array.from(event.dataTransfer.files));
      }}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-cream/10 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center bg-seal font-serif text-lg text-paper"
            aria-hidden
          >
            落
          </span>
          <div className="min-w-0">
            <h1 className="font-serif text-xl text-balance">落文</h1>
            <p className="text-sm text-pretty text-muted">
              把图片拖进窗口，文字落在这篇文稿的光标上。要贴到别的窗口，用复制。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-cream/10 p-1" role="group" aria-label="详略">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                className={`min-h-11 rounded-full px-4 text-sm ${focusRing} ${
                  mode === item.id ? "bg-seal text-paper" : "text-cream"
                }`}
                onClick={() => {
                  modeDirty.current = true;
                  setMode(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-full bg-cream/10 p-1" role="group" aria-label="输出语言">
            {LANGS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={lang === item.id}
                className={`min-h-11 rounded-full px-4 text-sm ${focusRing} ${
                  lang === item.id ? "bg-seal text-paper" : "text-cream"
                }`}
                onClick={() => {
                  langDirty.current = true;
                  setLang(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 lg:flex-row lg:px-6">
        <section className="flex min-h-0 flex-1 flex-col gap-3">
          <label className="sr-only" htmlFor="manuscript">
            文稿
          </label>
          <textarea
            id="manuscript"
            ref={taRef}
            value={text}
            spellCheck={false}
            placeholder="光标停在这里。拖入图片、粘贴，或点「选择图片」。读完的文字会落在光标上。"
            className={`min-h-48 w-full flex-1 resize-none rounded-md bg-paper px-4 py-4 font-serif text-base leading-relaxed text-walnut shadow-paper outline-none placeholder:text-walnut/35 sm:px-5 sm:py-5 ${focusRing}`}
            onChange={(event) => {
              const next = event.target.value;
              textDirty.current = true;
              textRef.current = next;
              setText(next);
              syncCaret(event.target);
              try {
                localStorage.setItem(DRAFT_KEY, next);
              } catch {
                /* quota */
              }
            }}
            onSelect={(event) => syncCaret(event.currentTarget)}
            onKeyUp={(event) => syncCaret(event.currentTarget)}
            onClick={(event) => syncCaret(event.currentTarget)}
          />
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" role="status">
            <span className="tabular-nums">{caretLabel(caret.start, caret.end)}</span>
            {busy > 0 ? <span className="tabular-nums">正在读 {busy} 张</span> : null}
            {status ? <span>{status}</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                const list = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (list.length) enqueueRef.current(list);
              }}
            />
            <button
              type="button"
              className={`min-h-11 bg-seal px-4 text-sm text-paper ${focusRing}`}
              onClick={() => fileRef.current?.click()}
            >
              选择图片
            </button>
            <button
              type="button"
              className={`min-h-11 px-3 text-sm ring-1 ring-cream/20 ${focusRing}`}
              onClick={() => void copyText(text, "文稿是空的")}
            >
              复制全文
            </button>
            <button
              type="button"
              disabled={!lastBlock}
              className={`min-h-11 px-3 text-sm ring-1 ring-cream/20 disabled:opacity-40 ${focusRing}`}
              onClick={() => void copyText(lastBlock, "还没有落过的文字")}
            >
              复制上一块
            </button>
            <button
              type="button"
              className={`min-h-11 px-3 text-sm ring-1 ring-cream/20 ${focusRing}`}
              onClick={() => {
                if (!text) return;
                if (!armClear) {
                  setArmClear(true);
                  return;
                }
                commit("", 0);
                setArmClear(false);
                setStatus("文稿已清空");
              }}
            >
              {armClear ? "再按一次确认" : "清空文稿"}
            </button>
          </div>
        </section>

        <aside className="flex max-h-44 shrink-0 flex-col gap-2 lg:max-h-none lg:w-72">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-serif text-sm">近稿</h2>
            {history.length > 0 ? (
              <button
                type="button"
                className={`min-h-11 px-2 text-xs text-muted ${focusRing}`}
                onClick={() => {
                  setHistory([]);
                  setLastBlock("");
                }}
              >
                清除
              </button>
            ) : null}
          </div>
          {history.length === 0 ? (
            <p className="px-1 text-sm text-pretty text-muted">还没有落过的图。拖一张进来。</p>
          ) : (
            <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
              {history.map((item) => (
                <li key={item.id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    className={`flex w-56 gap-3 bg-cream/5 p-2 text-left ring-1 ring-cream/10 lg:w-full ${focusRing}`}
                    onClick={() => insertBlock(item.text)}
                  >
                    {item.thumb ? (
                      <img src={item.thumb} alt="" className="size-14 shrink-0 object-cover" />
                    ) : (
                      <span className="grid size-14 shrink-0 place-items-center bg-seal font-serif text-paper">
                        落
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{item.name}</span>
                      <span className="line-clamp-2 text-xs text-muted">{excerpt(item.text)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {dragging ? (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-walnut/85 px-6"
          role="status"
        >
          <div className="border border-dashed border-cream/40 px-8 py-8 text-center">
            <div className="mx-auto grid size-16 place-items-center bg-seal font-serif text-2xl text-paper">
              落
            </div>
            <p className="mt-4 font-serif text-2xl text-balance">松开，落成文字</p>
            <p className="mt-2 text-sm text-muted">插在当前光标处</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
