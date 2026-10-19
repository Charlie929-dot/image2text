export type Mode = "full" | "brief" | "ocr";
export type Lang = "zh" | "en";

export function newId(): string {
  const rand = Math.random().toString(36).slice(2, 6);
  const time = Date.now().toString(36).slice(-4);
  return `${rand}${time}`;
}

export function markerLine(id: string, filename: string): string {
  const name = filename.replace(/[\r\n]+/g, " ").trim().slice(0, 60) || "图片";
  return `【落文 ${id}】正在读 ${name}`;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function insertAt(
  text: string,
  start: number,
  end: number,
  block: string,
): { text: string; caret: number } {
  const a = clamp(start, 0, text.length);
  const b = clamp(Math.max(end, a), a, text.length);
  const before = text.slice(0, a);
  const after = text.slice(b);
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const inserted = `${prefix}${block}${suffix}`;
  const next = before + inserted + after;
  return { text: next, caret: before.length + inserted.length };
}

export function replaceMarker(
  text: string,
  marker: string,
  replacement: string,
): { text: string; found: boolean; caret: number } {
  const at = text.indexOf(marker);
  if (at < 0) {
    const gap = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    const body = replacement.endsWith("\n") ? replacement : `${replacement}\n`;
    const next = text + gap + body;
    return { text: next, found: false, caret: next.length };
  }
  const next = text.slice(0, at) + replacement + text.slice(at + marker.length);
  return { text: next, found: true, caret: at + replacement.length };
}

export function removeMarker(text: string, marker: string): { text: string; caret: number } {
  const at = text.indexOf(marker);
  if (at < 0) return { text, caret: text.length };
  const next = (text.slice(0, at) + text.slice(at + marker.length)).replace(/\n{3,}/g, "\n\n");
  return { text: next, caret: Math.min(at, next.length) };
}

export function excerpt(xml: string): string {
  const scene = xml.match(/<scene>([\s\S]*?)<\/scene>/i)?.[1]?.trim() ?? "";
  const visible = xml.match(/<visible_text>([\s\S]*?)<\/visible_text>/i)?.[1]?.trim() ?? "";
  const pick =
    scene && scene !== "无"
      ? scene
      : visible && visible !== "无"
        ? visible
        : xml.replace(/<[^>]+>/g, " ");
  return pick.replace(/\s+/g, " ").trim().slice(0, 72);
}

export function caretLabel(start: number, end: number): string {
  if (start !== end) return `选中 ${end - start} 字`;
  if (start <= 0) return "光标在开头";
  return `光标在第 ${start} 字`;
}
