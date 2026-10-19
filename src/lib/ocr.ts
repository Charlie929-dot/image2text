import { createWorker } from "tesseract.js";

export type OcrProgress = { status: string; progress: number };

let workerPromise: ReturnType<typeof createWorker> | undefined;

function getWorker(onProgress?: (progress: OcrProgress) => void) {
  workerPromise ??= createWorker("chi_sim+eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/tesseract-core-lstm.wasm.js",
    langPath: "/ocr/lang",
    gzip: true,
    logger: ({ status, progress }) => onProgress?.({ status, progress }),
  }).catch((error) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

export async function readImageLocally(
  image: Tesseract.ImageLike,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const worker = await getWorker(onProgress);
  const result = await worker.recognize(image);
  const text = result.data.text.trim();
  return text || "（没有识别到文字）";
}
