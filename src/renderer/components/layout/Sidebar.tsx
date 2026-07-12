import React from 'react'
import { FolderPlus, Folder, Trash2, RefreshCw, Loader2, CheckCircle2, AlertCircle, Coins, Settings, ChevronUp, ChevronDown } from 'lucide-react'
import { useFolderStore, type FolderProject } from '../../stores/folderStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTokenUsageStore } from '../../stores/tokenUsageStore'
import { useSidebarStore } from '../../stores/sidebarStore'
import { Button } from '../ui/Button'
import { formatFileSize, formatChatTime } from '../../utils/formatters'
import { api } from '../../api/neutralino'

/** 折叠按钮共享样式：Raft 风格 — hover 浮起 + 阴影扩大，active 按下消失 */
const COLLAPSE_BTN =
  'p-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-yellow shadow-brutal-sm hover:shadow-brutal hover:-translate-x-[1px] hover:-translate-y-[1px] active:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150 ease-out flex-shrink-0'

export const Sidebar: React.FC = () => {
  // --- Folder state ---
  const folders = useFolderStore((s) => s.folders)
  const activeFolderId = useFolderStore((s) => s.activeFolderId)
  const setActiveFolder = useFolderStore((s) => s.setActiveFolder)
  const addFolder = useFolderStore((s) => s.addFolder)
  const removeFolder = useFolderStore((s) => s.removeFolder)
  const scanFolder = useFolderStore((s) => s.scanFolder)
  const foldersCollapsed = useFolderStore((s) => s.foldersCollapsed)
  const toggleFoldersCollapsed = useFolderStore((s) => s.toggleFoldersCollapsed)

  // --- Chat / Agent state ---
  const activeAgentId = useChatStore((s) => s.activeAgentId)
  const setActiveAgent = useChatStore((s) => s.setActiveAgent)
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const switchToSession = useChatStore((s) => s.switchToSession)
  const deleteSession = useChatStore((s) => s.deleteSession)

  // --- Settings / Token state ---
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)
  const toggleDashboard = useTokenUsageStore((s) => s.toggleDashboard)
  const sessionTotal = useTokenUsageStore((s) => s.sessionTotal)

  // --- Sidebar collapse state ---
  const agentsCollapsed = useSidebarStore((s) => s.agentsCollapsed)
  const toggleAgentsCollapsed = useSidebarStore((s) => s.toggleAgentsCollapsed)
  const setAgentsCollapsed = useSidebarStore((s) => s.setAgentsCollapsed)
  const historyCollapsed = useSidebarStore((s) => s.historyCollapsed)
  const toggleHistoryCollapsed = useSidebarStore((s) => s.toggleHistoryCollapsed)
  const setHistoryCollapsed = useSidebarStore((s) => s.setHistoryCollapsed)
  const agents = useSidebarStore((s) => s.agents)

  const handleSelect = async () => {
    const path = await api.selectFolder()
    if (!path) return
    const name = path.split('\\').pop() || path.split('/').pop() || '未命名'
    await addFolder(name, path)
  }

  const sortedAgents = [...agents].sort((a, b) => (a.id === 'leader' ? -1 : b.id === 'leader' ? 1 : 0))

  return (
    <div className="flex flex-col h-full border-r-2 border-brutal-black bg-white" style={{ boxShadow: '4px 0 0 #141111' }}>
      {/* === Scrollable middle area === */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Section: 文件夹 ── */}
        <div className="border-b-2 border-brutal-black">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-brutal-cream">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-4 bg-brutal-yellow border border-brutal-black" />
              <span className="font-bold text-xs uppercase text-black/80">文件夹</span>
              <span className="text-[10px] text-black/70 font-mono">{folders.length}</span>
            </div>
            {folders.length > 0 && (
              <button
                onClick={toggleFoldersCollapsed}
                className={COLLAPSE_BTN}
                title={foldersCollapsed ? '展开文件夹' : '折叠文件夹'}
              >
                {foldersCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            )}
          </div>
          {!foldersCollapsed && (
            <div className="px-3 pb-2">
              <Button variant="secondary" size="sm" onClick={handleSelect} icon={<FolderPlus size={14} />} className="w-full justify-center">
                选择文件夹
              </Button>
            </div>
          )}
          {foldersCollapsed && folders.length > 0 ? (
            <div
              onClick={toggleFoldersCollapsed}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-brutal-cream transition-colors duration-150"
              title="点击展开文件夹列表"
            >
              <div className="flex items-center gap-1">
                {folders.map((f) => (
                  <div key={f.id} className="w-2 h-2 flex-shrink-0 border-2 border-brutal-black rounded-[2px]" style={{ backgroundColor: f.color }} />
                ))}
              </div>
              <span className="text-[10px] text-black/70 font-mono">{folders.length} 个文件夹</span>
            </div>
          ) : (
            <div className="divide-y divide-black/10">
              {folders.length === 0 ? (
                <div className="px-4 py-6 text-center text-black/70 text-sm">
                  <Folder size={28} className="mx-auto mb-1.5 opacity-70" />
                  <p className="text-xs">点击上方按钮选择文件夹</p>
                </div>
              ) : (
                folders.map((f) => (
                  <FolderItem key={f.id} folder={f} isActive={f.id === activeFolderId}
                    onSelect={() => setActiveFolder(f.id)} onRefresh={() => scanFolder(f.id)} onRemove={() => removeFolder(f.id)} />
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Section: Agent ── */}
        <div className="border-b-2 border-brutal-black">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-brutal-cream">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-4 bg-brutal-pink border border-brutal-black" />
              <span className="font-bold text-xs text-black/80">AI Agent</span>
              <span className="text-[10px] text-black/70 font-mono">{sortedAgents.length}</span>
            </div>
            <button
              onClick={toggleAgentsCollapsed}
              className={COLLAPSE_BTN}
              title={agentsCollapsed ? '展开 AI Agent' : '折叠 AI Agent'}
            >
              {agentsCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
          {agentsCollapsed ? (
            <div
              onClick={() => setAgentsCollapsed(false)}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-brutal-cream transition-colors duration-150"
              title="点击展开 AI Agent 列表"
            >
              <div className="flex items-center gap-1">
                {sortedAgents.map((a) => (
                  <div key={a.id} className="w-2 h-2 flex-shrink-0 border-2 border-brutal-black rounded-[2px]" style={{ backgroundColor: a.color }} />
                ))}
              </div>
              <span className="text-[10px] text-black/70 font-mono">{sortedAgents.length} 个 AI Agent</span>
            </div>
          ) : sortedAgents.length === 0 ? (
            <div className="px-4 py-4 text-center text-black/70 text-sm">
              <p className="text-[10px] font-mono">Agent 加载中...</p>
            </div>
          ) : (
            <div className="divide-y divide-black/10">
              {sortedAgents.map((a) => (
                <div
                  key={a.id}
                  onClick={() => { setActiveAgent(a.id) }}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-all duration-150 border-l-4 ${a.id === activeAgentId ? 'bg-brutal-yellow border-brutal-yellow' : 'border-transparent hover:bg-brutal-cream hover:border-brutal-black'}`}
                  style={a.id === activeAgentId ? { boxShadow: 'inset 3px 3px 0 #141111' } : undefined}
                >
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 border-2 border-brutal-black rounded-[3px]" style={{ backgroundColor: a.color, boxShadow: '2px 2px 0 #141111' }}>
                    {(() => { const Icon = a.icon; return <Icon size={14} strokeWidth={2.5} className="text-brutal-black" /> })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold truncate">{a.name}</span>
                      {a.id === 'leader' && (
                        <span className="text-[8px] text-black/70 font-mono bg-brutal-yellow px-1 border border-brutal-black rounded-[3px]">推荐</span>
                      )}
                    </div>
                    <div className="text-[10px] text-black/70 truncate mt-0.5">{a.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Section: 对话历史 ── */}
        <div className="border-b-2 border-brutal-black">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-brutal-cream">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-4 bg-brutal-lavender border border-brutal-black" />
              <span className="font-bold text-xs uppercase text-black/80">历史</span>
              <span className="text-[10px] text-black/70 font-mono">{sessions.length}</span>
            </div>
            <button
              onClick={toggleHistoryCollapsed}
              className={COLLAPSE_BTN}
              title={historyCollapsed ? '展开历史' : '折叠历史'}
            >
              {historyCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
          {historyCollapsed ? (
            <div
              onClick={() => setHistoryCollapsed(false)}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-brutal-cream transition-colors duration-150"
              title="点击展开对话历史"
            >
              <span className="text-[10px] text-black/70 font-mono">{sessions.length} 个对话</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-4 text-center text-black/70 text-sm">
              <p className="text-[10px] font-mono">暂无历史对话</p>
            </div>
          ) : (
            <div className="divide-y divide-black/10">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => switchToSession(s.id)}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-all duration-150 border-l-4 ${s.id === currentSessionId ? 'bg-brutal-yellow border-brutal-yellow' : 'border-transparent hover:bg-brutal-cream hover:border-brutal-black'}`}
                  style={s.id === currentSessionId ? { boxShadow: 'inset 3px 3px 0 #141111' } : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">{s.title}</div>
                    <div className="text-[10px] text-black/70 font-mono mt-0.5">
                      {formatChatTime(s.timestamp)} · {s.messageCount} 条消息
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                    className="hidden group-hover:flex p-1 border border-brutal-black hover:bg-brutal-pink hover:text-white flex-shrink-0 transition-colors duration-150"
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* === Fixed bottom bar === */}
      <div className="p-3 border-t-2 border-brutal-black space-y-2 flex-shrink-0">
        <div className="text-[10px] text-black/70 font-mono text-center border-2 border-brutal-black py-1 bg-brutal-cream shadow-brutal-sm">
          共 {folders.reduce((s, f) => s + f.fileCount, 0)} 个文件
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => toggleDashboard()}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 border-2 border-brutal-black bg-white hover:bg-brutal-yellow shadow-brutal-sm hover:shadow-brutal hover:-translate-x-[1px] hover:-translate-y-[1px] active:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150 ease-out"
            title="Token 用量"
          >
            <Coins size={14} />
            <span className="text-xs font-mono font-bold">{sessionTotal > 0 ? (sessionTotal >= 1000 ? `${(sessionTotal / 1000).toFixed(1)}k` : sessionTotal) : '0'}</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 border-2 border-brutal-black bg-white hover:bg-brutal-yellow shadow-brutal-sm hover:shadow-brutal hover:-translate-x-[1px] hover:-translate-y-[1px] active:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150 ease-out"
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
    <div onClick={onSelect} className={`group px-3 py-2.5 cursor-pointer transition-all duration-150 border-l-4 ${isActive ? 'bg-brutal-yellow border-brutal-yellow' : 'border-transparent hover:bg-brutal-cream hover:border-brutal-black'}`} style={isActive ? { boxShadow: 'inset 3px 3px 0 #141111' } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-2.5 h-2.5 flex-shrink-0 border-2 border-brutal-black rounded-[2px]" style={{ backgroundColor: folder.color }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate">{folder.name}</div>
            <div className="text-[10px] text-black/70 font-mono truncate mt-0.5">{folder.path}</div>
          </div>
        </div>
        <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onRefresh() }} className="p-1 hover:bg-brutal-yellow transition-colors duration-150" title="刷新"><RefreshCw size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); onRemove() }} className="p-1 hover:bg-brutal-pink hover:text-white transition-colors duration-150" title="移除"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Scan status indicator */}
      {isScanning && (
        <div className="mt-2.5">
          {/* Progress bar */}
          <div className="relative h-5 border-2 border-brutal-black bg-white" style={{ boxShadow: '3px 3px 0px #141111' }}>
            <div
              className="h-full bg-brutal-yellow transition-all duration-200 ease-out"
              style={{ width: `${folder.scanProgress ?? 0}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-black drop-shadow-[1px_1px_0px_rgba(255,255,255,0.8)]">
                {folder.scanProgress ?? 0}%
              </span>
            </div>
          </div>
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
