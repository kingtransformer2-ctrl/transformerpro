export interface ElectronAPI {
  getUserDataPath: () => Promise<string>
  dbWrite: (filename: string, data: Uint8Array) => Promise<boolean>
  dbRead: (filename: string) => Promise<Uint8Array | null>
  platform: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
