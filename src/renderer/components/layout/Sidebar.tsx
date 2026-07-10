import React from 'react'
import { FolderPlus, Folder, Trash2, RefreshCw, Loader2, CheckCircle2, AlertCircle, Coins, Settings } from 'lucide-react'
import { useFolderStore, type FolderProject } from '../../stores/folderStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTokenUsageStore } from '../../stores/tokenUsageStore'
import { Button } from '../ui/Button'
import { formatFileSize } from '../../utils/formatters'
import { api } from '../../api/neutralino'

export const Sidebar: React.FC = () => {
  const folders = useFolderStore((s) => s.folders)
  const activeFolderId = useFolderStore((s) => s.activeFolderId)
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder)
  const addFolder = useFolderStore((s) => s.addFolder)
  const removeFolder = useFolderStore((s) => s.removeFolder)
  const scanFolder = useFolderStore((s) => s.scanFolder)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)
  const toggleDashboard = useTokenUsageStore((s) => s.toggleDashboard)
  const sessionTotal = useTokenUsageStore((s) => s.sessionTotal)

  const handleSelect = async () => {
    const path = await api.selectFolder()
    if (!path) return
    const name = path.split('\\').pop() || path.split('/').pop() || '未命名'
    await addFolder(name, path)
  }

  return (
    <div className="flex flex-col h-full border-r-2 border-brutal-black bg-white">
      <div className="p-3 border-b-2 border-brutal-black">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-bold text-sm uppercase text-black/80">文件夹</span>
          <span className="text-[10px] text-black/70 font-mono">{folders.length}</span>
        </div>
        <Button variant="secondary" size="sm" onClick={handleSelect} icon={<FolderPlus size={14} />} className="w-full justify-center">
          选择文件夹
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {folders.length === 0 ? (
          <div className="px-4 py-8 text-center text-black/70 text-sm">
            <Folder size={32} className="mx-auto mb-2 opacity-70" />
            点击上方按钮选择文件夹
          </div>
        ) : (
          folders.map((f) => (
            <FolderItem key={f.id} folder={f} isActive={f.id === activeFolderId}
              onSelect={() => setActiveFolder(f.id)} onRefresh={() => scanFolder(f.id)} onRemove={() => removeFolder(f.id)} />
          ))
        )}
      </div>

      <div className="p-3 border-t-2 border-brutal-black space-y-2">
        <div className="text-[10px] text-black/70 font-mono text-center">
          共 {folders.reduce((s, f) => s + f.fileCount, 0)} 个文件
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => toggleDashboard()}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 border-2 border-brutal-black bg-white hover:bg-brutal-yellow transition-colors"
            style={{ boxShadow: '2px 2px 0px #141111' }}
            title="Token 用量"
          >
            <Coins size={14} />
            <span className="text-xs font-mono font-bold">{sessionTotal > 0 ? (sessionTotal >= 1000 ? `${(sessionTotal / 1000).toFixed(1)}k` : sessionTotal) : '0'}</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 border-2 border-brutal-black bg-white hover:bg-brutal-yellow transition-colors"
            style={{ boxShadow: '2px 2px 0px #141111' }}
            title="设置"
          >
            <Settings size={14} />
            <span className="text-xs font-bold">设置</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const FolderItem: React.FC<{ folder: FolderProject; isActive: boolean; onSelect: () => void; onRefresh: () => void; onRemove: () => void }> = ({ folder, isActive, onSelect, onRefresh, onRemove }) => {
  const totalSize = folder.files?.reduce((s, f) => s + f.size, 0) || 0
  const isScanning = folder.scanStatus === 'scanning'
  const isSuccess = folder.scanStatus === 'success'
  const isError = folder.scanStatus === 'error'

  return (
    <div onClick={onSelect} className={`group px-3 py-2.5 cursor-pointer transition-all duration-75 border-l-4 ${isActive ? 'bg-brutal-yellow border-brutal-yellow' : 'border-transparent hover:bg-brutal-cream hover:border-brutal-black'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 border-2 border-brutal-black" style={{ backgroundColor: folder.color }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate">{folder.name}</div>
            <div className="text-[10px] text-black/70 font-mono truncate mt-0.5">{folder.path}</div>
          </div>
        </div>
        <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onRefresh() }} className="p-1 hover:bg-brutal-yellow" title="刷新"><RefreshCw size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); onRemove() }} className="p-1 hover:bg-brutal-pink hover:text-white" title="移除"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Scan status indicator */}
      {isScanning && (
        <div className="mt-2.5">
          {/* Progress bar — Neo-Brutalist: thick border, hard shadow, no rounded corners */}
          <div className="relative h-5 border-2 border-brutal-black bg-white" style={{ boxShadow: '3px 3px 0px #141111' }}>
            <div
              className="h-full bg-brutal-yellow transition-all duration-200 ease-out"
              style={{ width: `${folder.scanProgress ?? 0}%` }}
            />
            {/* Percentage label inside the bar */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-black drop-shadow-[1px_1px_0px_rgba(255,255,255,0.8)]">
                {folder.scanProgress ?? 0}%
              </span>
            </div>
          </div>
          {/* Count info below the bar */}
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-black/80">
            <Loader2 size={10} className="animate-spin" />
            <span>{folder.scanCurrent ?? 0} / {folder.scanTotal ?? 0} 项</span>
          </div>
        </div>
      )}

      {isSuccess && (
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-black/70 font-mono">
          <CheckCircle2 size={10} className="text-brutal-lime flex-shrink-0" />
          <span>{folder.fileCount} 个文件</span>
          {totalSize > 0 && <><span>·</span><span>{formatFileSize(totalSize)}</span></>}
        </div>
      )}

      {isError && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-brutal-pink">
          <AlertCircle size={10} />
          <span className="truncate">{folder.scanError || '扫描失败'}</span>
        </div>
      )}

      {!isScanning && !isSuccess && !isError && (
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-black/70 font-mono">
          <span>{folder.fileCount} 个文件</span>
          {totalSize > 0 && <><span>·</span><span>{formatFileSize(totalSize)}</span></>}
        </div>
      )}
    </div>
  )
}
