/**
 * 平台抽象接口
 * 所有 Agent 通过此接口调用平台能力，不直接依赖 Neutralino
 * 未来切换到鸿蒙等平台只需实现此接口
 */

// ---- 文件条目 ----
export interface FileEntry {
  name: string
  path: string
  relativePath: string
  ext: string
  size: number
  modifiedAt: string
  isDirectory: boolean
  children?: FileEntry[]
}

// ---- 文件系统 ----
export interface PlatformFS {
  scanDirectory(dirPath: string, onProgress?: (percent: number, current: number, total: number) => void): Promise<FileEntry[]>
  readFile(filePath: string): Promise<{ content: string | null; error: string | null; size: number }>
  readBinaryFile(filePath: string): Promise<{ content: ArrayBuffer | null; error: string | null; size: number }>
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>
  writeBinaryFile(filePath: string, content: ArrayBuffer): Promise<{ success: boolean; error?: string }>
  createDirectory(dirPath: string): Promise<{ success: boolean; error?: string }>
  moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }>
  moveDirectory(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }>
  searchInDirectory(dirPath: string, keyword: string): Promise<{ file: FileEntry; matches: { line: number; content: string }[] }[]>
}

// ---- 存储 ----
export interface PlatformStorage {
  getApiKey(provider: string): Promise<string | null>
  setApiKey(provider: string, key: string): Promise<boolean>
  getSettings(): Promise<Record<string, any>>
  setSettings(settings: Record<string, any>): Promise<void>
  /** 通用键值存储（用于 Memory 等模块） */
  getData(key: string): Promise<string | null>
  setData(key: string, value: string): Promise<boolean>
}

// ---- 窗口 ----
export interface PlatformWindow {
  minimize(): void
  maximize(): Promise<void>
  close(): void
  isMaximized(): Promise<boolean>
  setDraggableRegion(el: HTMLElement): void
}

// ---- OS 命令 ----
export interface PlatformOS {
  execCommand(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

// ---- 平台统一接口 ----
export interface PlatformAPI {
  readonly fs: PlatformFS
  readonly storage: PlatformStorage
  readonly window: PlatformWindow
  readonly os: PlatformOS
  selectFolder(): Promise<string | null>
}
