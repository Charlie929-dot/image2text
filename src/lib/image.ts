const MAX_DATA_URL = 2_400_000;

export function isMaybeImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name);
}

function sourceSize(source: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  const sized = source as { width?: number; height?: number };
  return { w: sized.width ?? 0, h: sized.height ?? 0 };
}

function raster(source: CanvasImageSource, maxEdge: number, quality: number): string {
  const { w: srcW, h: srcH } = sourceSize(source);
  if (!srcW || !srcH) throw new Error("这张图是空的");
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理这张图");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function encode(source: CanvasImageSource): { dataUrl: string; thumb: string } {
  let dataUrl = raster(source, 1536, 0.82);
  if (dataUrl.length > MAX_DATA_URL) dataUrl = raster(source, 1280, 0.74);
  if (dataUrl.length > MAX_DATA_URL) dataUrl = raster(source, 1024, 0.66);
  if (dataUrl.length > MAX_DATA_URL) throw new Error("图片太大，请换一张更小的");
  return { dataUrl, thumb: raster(source, 160, 0.7) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("这张图浏览器打不开，请换 jpg 或 png"));
    img.src = url;
  });
}

export async function fileToJpeg(file: File): Promise<{ dataUrl: string; thumb: string }> {
  if (!isMaybeImage(file)) throw new Error("不是图片");
  if (file.size > 20 * 1024 * 1024) throw new Error("图片超过 20MB，请换一张小的");

  try {
    const bitmap = await createImageBitmap(file);
    try {
      return encode(bitmap);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "图片太大，请换一张更小的") throw error;
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return encode(img);
  } catch {
    throw new Error("这张图浏览器打不开，请换 jpg 或 png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
