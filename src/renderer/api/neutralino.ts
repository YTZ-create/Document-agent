/**
 * Neutralino API 封装层
 * 所有原生功能（文件系统/存储/窗口）的统一入口
 */

import type { PlatformAPI, PlatformFS, PlatformStorage, PlatformWindow, PlatformOS, FileEntry } from './platformAPI'

declare global {
  interface Window {
    Neutralino: any
  }
}

// ---- 类型 ----
export type { FileEntry } from './platformAPI'

interface NLDirectoryEntry {
  entry: string
  path: string
  type: 'FILE' | 'DIRECTORY'
}

interface NLStats {
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

const MAX_READ_SIZE = 50 * 1024 * 1024 // 50MB，支持大型 docx/pdf 文件
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', '.next', '.nuxt', 'target', 'build', '.cache'])

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.substring(i).toLowerCase()
}

// ---- 文件系统 ----
// 轻量预扫描：只计数，不读文件内容，用于计算进度百分比
async function _countDirectory(dirPath: string): Promise<number> {
  if (!window.Neutralino) return 0
  try {
    const entries: NLDirectoryEntry[] = await window.Neutralino.filesystem.readDirectory(dirPath)
    let count = 0
    for (const e of entries) {
      try {
        if (e.type === 'DIRECTORY' && SKIP_DIRS.has(e.entry)) continue
        count++
        if (e.type === 'DIRECTORY') {
          count += await _countDirectory(e.path)
        }
      } catch { /* skip */ }
    }
    return count
  } catch {
    return 0
  }
}

async function _scanDirectory(dirPath: string, depth: number, counter: { current: number }, total: number, onProgress?: (current: number, total: number) => void): Promise<FileEntry[]> {
  if (!window.Neutralino) return []
  try {
    const entries: NLDirectoryEntry[] = await window.Neutralino.filesystem.readDirectory(dirPath)
    const results: FileEntry[] = []
    for (const e of entries) {
      try {
        const stats: NLStats = await window.Neutralino.filesystem.getStats(e.path)
        if (e.type === 'DIRECTORY' && SKIP_DIRS.has(e.entry)) continue

        const fe: FileEntry = {
          name: e.entry,
          path: e.path,
          relativePath: e.path.replace(dirPath, '').replace(/^[/\\]/, ''),
          ext: e.type === 'DIRECTORY' ? '' : getExt(e.entry),
          size: stats.size,
          modifiedAt: new Date(stats.modifiedAt).toISOString(),
          isDirectory: e.type === 'DIRECTORY',
        }
        if (e.type === 'DIRECTORY') {
          fe.children = await _scanDirectory(e.path, depth + 1, counter, total, onProgress)
        }
        results.push(fe)
        counter.current++
        if (onProgress) onProgress(counter.current, total)
      } catch { /* skip */ }
    }
    return results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

async function scanDirectory(dirPath: string, onProgress?: (percent: number, current: number, total: number) => void): Promise<FileEntry[]> {
  // 先轻量预扫描获取总数
  const total = await _countDirectory(dirPath)
  const counter = { current: 0 }
  let lastReported = 0
  const results = await _scanDirectory(dirPath, 0, counter, total, (current: number) => {
    if (total > 0 && onProgress) {
      const percent = Math.min(Math.round((current / total) * 100), 100)
      if (percent - lastReported >= 2 || percent === 100) {
        lastReported = percent
        onProgress(percent, current, total)
      }
    }
  })
  // 确保最终报告 100%
  if (onProgress && total > 0) {
    onProgress(100, counter.current, total)
  }
  return results
}

async function readFile(filePath: string): Promise<{ content: string | null; error: string | null; size: number }> {
  if (!window.Neutralino) return { content: null, error: 'Neutralino not available', size: 0 }
  try {
    const stats: NLStats = await window.Neutralino.filesystem.getStats(filePath)
    if (stats.size > MAX_READ_SIZE) return { content: null, error: `File too large (>${MAX_READ_SIZE / 1024 / 1024}MB)`, size: stats.size }
    const data: string = await window.Neutralino.filesystem.readFile(filePath)
    return { content: data, error: null, size: stats.size }
  } catch (err: any) {
    return { content: null, error: err.message || 'Unknown error', size: 0 }
  }
}

async function readBinaryFile(filePath: string): Promise<{ content: ArrayBuffer | null; error: string | null; size: number }> {
  if (!window.Neutralino) return { content: null, error: 'Neutralino not available', size: 0 }
  try {
    const stats: NLStats = await window.Neutralino.filesystem.getStats(filePath)
    if (stats.size > MAX_READ_SIZE) return { content: null, error: `File too large (>${MAX_READ_SIZE / 1024 / 1024}MB)`, size: stats.size }
    const data: ArrayBuffer = await window.Neutralino.filesystem.readBinaryFile(filePath)
    return { content: data, error: null, size: stats.size }
  } catch (err: any) {
    return { content: null, error: err.message || 'Unknown error', size: 0 }
  }
}

async function writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
  if (!window.Neutralino) return { success: false, error: 'Neutralino not available' }
  try {
    await window.Neutralino.filesystem.writeFile(filePath, content)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

async function writeBinaryFile(filePath: string, content: ArrayBuffer): Promise<{ success: boolean; error?: string }> {
  if (!window.Neutralino) return { success: false, error: 'Neutralino not available' }
  try {
    await window.Neutralino.filesystem.writeBinaryFile(filePath, content)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

async function createDirectory(dirPath: string): Promise<{ success: boolean; error?: string }> {
  if (!window.Neutralino) return { success: false, error: 'Neutralino not available' }
  try {
    await window.Neutralino.filesystem.createDirectory(dirPath)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

async function moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
  if (!window.Neutralino) return { success: false, error: 'Neutralino not available' }
  try {
    // 先读取源文件内容
    const content = await window.Neutralino.filesystem.readBinaryFile(sourcePath)
    
    // 写入临时文件（避免覆盖失败导致数据丢失）
    const tempPath = destPath + '.tmp'
    try {
      await window.Neutralino.filesystem.writeBinaryFile(tempPath, content)
    } catch (writeErr: any) {
      // 写入失败时清理可能已创建的临时文件
      try {
        await window.Neutralino.filesystem.removeFile(tempPath)
      } catch (cleanupErr: any) {
        console.warn('[neutralino] Failed to cleanup temp file after write error:', cleanupErr?.message)
      }
      throw writeErr
    }
    
    // 如果目标文件存在，先删除
    try {
      await window.Neutralino.filesystem.removeFile(destPath)
    } catch (removeErr: any) {
      // 目标文件不存在或删除失败，继续
      console.warn('[neutralino] Failed to remove dest file before rename:', removeErr?.message)
    }
    
    // 将临时文件重命名为目标文件
    try {
      await window.Neutralino.filesystem.renameFile(tempPath, destPath)
    } catch (renameErr: any) {
      // 重命名失败，尝试复制并删除临时文件
      console.warn('[neutralino] Failed to rename temp file, falling back to copy:', renameErr?.message)
      try {
        const tempContent = await window.Neutralino.filesystem.readBinaryFile(tempPath)
        await window.Neutralino.filesystem.writeBinaryFile(destPath, tempContent)
        await window.Neutralino.filesystem.removeFile(tempPath)
      } catch (fallbackErr: any) {
        console.error('[neutralino] Fallback copy failed:', fallbackErr?.message)
        throw fallbackErr
      }
    }
    
    // 删除源文件
    try {
      await window.Neutralino.filesystem.removeFile(sourcePath)
    } catch (removeErr: any) {
      console.warn('[neutralino] Failed to remove source file after move:', removeErr?.message)
      // 文件已移动成功但删除失败，仍然返回成功
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

async function moveDirectory(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
  if (!window.Neutralino) return { success: false, error: 'Neutralino not available' }
  try {
    // 递归移动目录
    const entries = await window.Neutralino.filesystem.readDirectory(sourcePath)
    await createDirectory(destPath)
    
    for (const entry of entries) {
      const srcEntry = `${sourcePath}/${entry.entry}`
      const destEntry = `${destPath}/${entry.entry}`
      
      if (entry.type === 'DIRECTORY') {
        await moveDirectory(srcEntry, destEntry)
      } else {
        await moveFile(srcEntry, destEntry)
      }
    }
    
    // 删除原目录（如果为空）
    try {
      await window.Neutralino.filesystem.removeDirectory(sourcePath)
    } catch {
      // 忽略删除失败
    }
    
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

async function searchInDirectory(dirPath: string, keyword: string): Promise<{ file: FileEntry; matches: { line: number; content: string }[] }[]> {
  const nameResults: { file: FileEntry; matches: { line: number; content: string }[] }[] = []
  const contentResults: { file: FileEntry; matches: { line: number; content: string }[] }[] = []
  // 二进制文件扩展名（跳过这些）
  const binaryExts = new Set(['.exe','.dll','.so','.dylib','.bin','.obj','.o','.a','.lib','.pyc','.pyo','.class','.jar','.war','.ear',
    '.png','.jpg','.jpeg','.gif','.bmp','.ico','.svg','.webp','.tiff','.tif',
    '.mp3','.mp4','.avi','.mov','.wmv','.flv','.mkv','.webm','.ogg','.wav','.aac',
    '.zip','.rar','.7z','.tar','.gz','.bz2','.xz','.cab','.iso',
    '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
    '.woff','.woff2','.ttf','.otf','.eot',
    '.db','.sqlite','.sqlite3','.mdb','.accdb',
    '.wasm','.map','.min.js','.min.css'])

  async function searchDir(currentPath: string): Promise<void> {
    if (!window.Neutralino) return
    try {
      const entries: NLDirectoryEntry[] = await window.Neutralino.filesystem.readDirectory(currentPath)
      for (const e of entries) {
        try {
          if (e.type === 'DIRECTORY') {
            if (SKIP_DIRS.has(e.entry)) continue
            await searchDir(e.path)
          } else {
            const ext = getExt(e.entry).toLowerCase()
            if (binaryExts.has(ext)) continue
            const lower = keyword.toLowerCase()
            const fileEntry: FileEntry = {
              name: e.entry,
              path: e.path,
              relativePath: e.path.replace(dirPath, '').replace(/^[/\\]/, ''),
              ext: ext,
              size: 0,
              modifiedAt: '',
              isDirectory: false,
            }
            // 优先：文件名匹配
            if (e.entry.toLowerCase().includes(lower)) {
              nameResults.push({ file: fileEntry, matches: [{ line: 0, content: '[文件名匹配]' }] })
            }
            // 补充：文件内容匹配
            const { content } = await readFile(e.path)
            if (content) {
              const matches: { line: number; content: string }[] = []
              content.split('\n').forEach((line, i) => {
                if (line.toLowerCase().includes(lower)) matches.push({ line: i + 1, content: line.trim().substring(0, 200) })
              })
              if (matches.length > 0) {
                contentResults.push({ file: fileEntry, matches: matches.slice(0, 10) })
              }
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  await searchDir(dirPath)
  // 文件名匹配排在前面，内容匹配排在后面
  const allResults = [...nameResults, ...contentResults.filter((r) => !nameResults.find((n) => n.file.path === r.file.path))]
  return allResults.slice(0, 100)
}

async function selectFolder(): Promise<string | null> {
  if (!window.Neutralino) return null
  try {
    const result = await window.Neutralino.os.showFolderDialog('选择文件夹')
    return result || null
  } catch { return null }
}

// ---- 存储 ----
const storage: PlatformStorage = {
  async getApiKey(provider: string): Promise<string | null> {
    if (!window.Neutralino) return null
    try { return await window.Neutralino.storage.getData(`apikey_${provider}`) || null } catch { return null }
  },
  async setApiKey(provider: string, key: string): Promise<boolean> {
    if (!window.Neutralino) return false
    try { await window.Neutralino.storage.setData(`apikey_${provider}`, key); return true } catch { return false }
  },
  async getSettings(): Promise<Record<string, any>> {
    if (!window.Neutralino) return {}
    try { const d = await window.Neutralino.storage.getData('app_settings'); return d ? JSON.parse(d) : {} } catch { return {} }
  },
  async setSettings(settings: Record<string, any>): Promise<void> {
    if (!window.Neutralino) return
    try { await window.Neutralino.storage.setData('app_settings', JSON.stringify(settings)) } catch { /* skip */ }
  },
  async getData(key: string): Promise<string | null> {
    if (!window.Neutralino) return null
    try { return await window.Neutralino.storage.getData(key) || null } catch { return null }
  },
  async setData(key: string, value: string): Promise<boolean> {
    if (!window.Neutralino) return false
    try { await window.Neutralino.storage.setData(key, value); return true } catch { return false }
  },
}

// ---- 窗口 ----
const windowApi: PlatformWindow = {
  minimize: () => {
    if (!window.Neutralino) return
    window.Neutralino.window.minimize().catch((e: any) => console.error('[AI Agent] minimize failed:', e))
  },
  maximize: async () => {
    if (!window.Neutralino) return
    try {
      const m = await window.Neutralino.window.isMaximized()
      if (m) { await window.Neutralino.window.unmaximize() } else { await window.Neutralino.window.maximize() }
    } catch (e) { console.error('[AI Agent] maximize failed:', e) }
  },
  close: () => {
    if (!window.Neutralino) return
    window.Neutralino.app.exit().catch((e: any) => console.error('[AI Agent] exit failed:', e))
  },
  isMaximized: () => window.Neutralino ? window.Neutralino.window.isMaximized() : Promise.resolve(false),
  setDraggableRegion: (el: HTMLElement) => {
    if (!window.Neutralino) return
    window.Neutralino.window.setDraggableRegion(el).catch((e: any) => console.error('[AI Agent] setDraggableRegion failed:', e))
  },
}

const fsApi: PlatformFS = { scanDirectory, readFile, readBinaryFile, writeFile, writeBinaryFile, searchInDirectory, createDirectory, moveFile, moveDirectory }

// ---- OS 命令 ----
const osApi: PlatformOS = {
  async execCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!window.Neutralino) return { stdout: '', stderr: 'Neutralino not available', exitCode: -1 }
    try {
      const result = await window.Neutralino.os.execCommand(command)
      return {
        stdout: result.stdOut || '',
        stderr: result.stdError || '',
        exitCode: result.code || 0,
      }
    } catch (err: any) {
      return { stdout: '', stderr: err.message || 'Unknown error', exitCode: -1 }
    }
  },
}

// ---- 工厂函数 ----
// ---- 全局平台实例（供 UI 组件使用） ----
let _platform: PlatformAPI | null = null

export function createNeutralinoPlatform(): PlatformAPI {
  _platform = {
    fs: fsApi,
    storage,
    window: windowApi,
    os: osApi,
    selectFolder,
  }
  return _platform
}

/** 获取全局平台实例 */
export function getPlatform(): PlatformAPI | null { return _platform }

// ---- 向后兼容的旧版导出（逐步迁移后移除） ----
export const api = {
  selectFolder,
  fs: fsApi,
  settings: storage,
  window: windowApi,
  os: osApi,
}

// ---- 初始化 ----
let _neutralinoReady = false
export function isNeutralinoReady(): boolean { return _neutralinoReady }

export async function initNeutralino(): Promise<void> {
  if (typeof window.Neutralino === 'undefined') {
    console.warn('[AI Agent] Neutralino not available, running in browser mode')
    return
  }
  console.log('[AI Agent] Neutralino object found, NL_PORT:', (window as any).NL_PORT, 'NL_TOKEN exists:', !!(window as any).NL_TOKEN)
  try {
    await window.Neutralino.init()
    _neutralinoReady = true
    console.log('[AI Agent] Neutralino initialized, ready:', _neutralinoReady)
    // 测试 window API 是否可用
    try {
      const maximized = await window.Neutralino.window.isMaximized()
      console.log('[AI Agent] window.isMaximized() test passed, result:', maximized)
    } catch (e: any) {
      console.error('[AI Agent] window.isMaximized() test FAILED:', e)
    }
  } catch (e: any) {
    console.warn('[AI Agent] Neutralino init error:', e)
  }
}
