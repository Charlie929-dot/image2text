export {};

declare global {
  interface Window {
    luowenDesktop?: {
      pasteResult(text: string): Promise<boolean>;
      cloudVision(input: { imageDataUrl: string; ocrText: string }): Promise<string>;
      getCloudSettings(): Promise<{ enabled: boolean; baseUrl: string; model: string }>;
      setCloudSettings(settings: { key: string; baseUrl: string }): Promise<{ enabled: boolean; baseUrl: string }>;
      onHotkeyOcr(callback: (imageDataUrl: string) => void): () => void;
      onHotkeyStatus(callback: (message: string) => void): () => void;
    };
  }
}
