export {};

declare global {
  interface Window {
    luowenDesktop?: {
      pasteResult(text: string): Promise<boolean>;
      cloudVision(input: { imageDataUrl: string; ocrText: string }): Promise<string>;
      getCloudSettings(): Promise<{ enabled: boolean; model: string }>;
      setCloudKey(key: string): Promise<{ enabled: boolean }>;
      onHotkeyOcr(callback: (imageDataUrl: string) => void): () => void;
      onHotkeyStatus(callback: (message: string) => void): () => void;
    };
  }
}
