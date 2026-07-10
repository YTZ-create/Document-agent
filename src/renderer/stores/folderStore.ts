import { create } from 'zustand'
import { api, type FileEntry } from '../api/neutralino'

export interface FolderProject {
  id: string
  name: string
  path: string
  color: string
  fileCount: number
  files?: FileEntry[]
  scanStatus?: 'scanning' | 'success' | 'error'
  scanError?: string
  scanProgress?: number
  scanCurrent?: number
  scanTotal?: number
}

const COLORS = ['#FE7DA8', '#BBAFE6', '#27CCF3', '#F8A16F', '#A9D877', '#FFD440']

interface FolderState {
  folders: FolderProject[]
  activeFolderId: string | null
  scanningFolderId: string | null
  setActiveFolder: (id: string | null) => void
  addFolder: (name: string, path: string) => Promise<void>
  removeFolder: (id: string) => void
  scanFolder: (id: string) => Promise<void>
  setScanningFolderId: (id: string | null) => void
  setFolderScanStatus: (id: string, status: 'scanning' | 'success' | 'error', error?: string) => void
}

export const useFolderStore = create<FolderState>((set, get) => ({
  folders: [],
  activeFolderId: null,
  scanningFolderId: null,

  setActiveFolder: (id) => set({ activeFolderId: id }),

  addFolder: async (name, path) => {
    const id = `folder-${Date.now()}`
    const color = COLORS[get().folders.length % COLORS.length]
    // 先添加一个扫描中的占位文件夹
    set((s) => ({
      folders: [...s.folders, { id, name, path, color, fileCount: 0, scanStatus: 'scanning', scanProgress: 0, scanCurrent: 0, scanTotal: 0 }],
      activeFolderId: id,
      scanningFolderId: id,
    }))
    try {
      const files = await api.fs.scanDirectory(path, (percent: number, current: number, total: number) => {
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, fileCount: current, scanStatus: 'scanning', scanProgress: percent, scanCurrent: current, scanTotal: total } : f)),
        }))
      })
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, files, fileCount: files.length, scanStatus: 'success', scanProgress: 100 } : f)),
        scanningFolderId: null,
      }))
    } catch (err: any) {
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, scanStatus: 'error', scanError: err.message } : f)),
        scanningFolderId: null,
      }))
    }
  },

  removeFolder: (id) =>
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      activeFolderId: s.activeFolderId === id ? null : s.activeFolderId,
      scanningFolderId: s.scanningFolderId === id ? null : s.scanningFolderId,
    })),

  scanFolder: async (id) => {
    const folder = get().folders.find((f) => f.id === id)
    if (!folder) return
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, scanStatus: 'scanning', scanProgress: 0, scanCurrent: 0, scanTotal: 0, scanError: undefined } : f)),
      scanningFolderId: id,
    }))
    try {
      const files = await api.fs.scanDirectory(folder.path, (percent: number, current: number, total: number) => {
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, fileCount: current, scanStatus: 'scanning', scanProgress: percent, scanCurrent: current, scanTotal: total } : f)),
        }))
      })
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, files, fileCount: files.length, scanStatus: 'success', scanProgress: 100 } : f)),
        scanningFolderId: null,
      }))
    } catch (err: any) {
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? { ...f, scanStatus: 'error', scanError: err.message } : f)),
        scanningFolderId: null,
      }))
    }
  },

  setScanningFolderId: (id) => set({ scanningFolderId: id }),
  setFolderScanStatus: (id, status, error) =>
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, scanStatus: status, scanError: error } : f
      ),
      scanningFolderId: status === 'scanning' ? id : s.scanningFolderId === id ? null : s.scanningFolderId,
    })),
}))
