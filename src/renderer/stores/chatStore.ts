import { create } from 'zustand'
import type { FileEntry } from '../api/neutralino'
import { api } from '../api/neutralino'

const STORAGE_KEY = 'chat_history'
const SESSIONS_KEY = 'chat_sessions'
const MAX_HISTORY = 50

// 防抖函数：延迟执行存储操作，避免频繁写入
let persistTimer: ReturnType<typeof setTimeout> | null = null
const debouncedPersist = (messages: ChatMessage[]) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      api.settings.setData(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)))
    } catch {
      // 存储失败，忽略
    }
  }, 500) // 500ms 防抖
}

export interface SearchResult {
  file: FileEntry
  matches: { line: number; content: string }[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  agentName?: string
  agentColor?: string
  timestamp: number
  files?: FileEntry[]
  searchResults?: SearchResult[]
}

export interface AgentConversationMessage {
  id: string
  agentName: string
  agentColor: string
  content: string
  timestamp: number
  isLeader?: boolean
}

export interface ChatSession {
  id: string
  title: string
  timestamp: number
  messageCount: number
  activeAgentId: string | null
}

interface ChatState {
  messages: ChatMessage[]
  agentConversation: AgentConversationMessage[]
  inputValue: string
  isStreaming: boolean
  activeAgentId: string | null
  abortController: AbortController | null
  /** 当前消息是从哪个已保存会话加载的，null 表示是新创建的未保存对话 */
  currentSessionId: string | null

  setInputValue: (v: string) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateLastMessage: (content: string) => void
  addAgentConversation: (msg: Omit<AgentConversationMessage, 'id' | 'timestamp'>) => void
  clearAgentConversation: () => void
  clearMessages: () => void
  clearChat: () => void
  setIsStreaming: (v: boolean) => void
  setActiveAgent: (id: string | null) => void
  setAbortController: (c: AbortController | null) => void
  sessions: ChatSession[]
  saveCurrentSession: () => void
  switchToSession: (id: string) => Promise<void>
  deleteSession: (id: string) => void
  stopGeneration: () => void
  persistMessages: () => void
  restoreMessages: () => Promise<void>
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  agentConversation: [],
  inputValue: '',
  isStreaming: false,
  activeAgentId: null,
  abortController: null,
  currentSessionId: null,
  sessions: [],

  setInputValue: (value) => set({ inputValue: value }),

  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) =>
    set((s) => {
      const newMessages = [
        ...s.messages,
        { ...msg, id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() },
      ]
      // 使用防抖持久化，避免频繁写入
      debouncedPersist(newMessages)
      // 新消息意味着这是一个新的对话，脱离已保存的会话
      return { messages: newMessages, currentSessionId: null }
    }),

  updateLastMessage: (content: string) =>
    set((s) => {
      const messages = [...s.messages]
      const lastIdx = messages.length - 1
      if (lastIdx >= 0 && messages[lastIdx].role === 'agent') {
        messages[lastIdx] = { ...messages[lastIdx], content }
      }
      // 使用防抖持久化，避免频繁写入
      debouncedPersist(messages)
      return { messages }
    }),

  addAgentConversation: (msg: Omit<AgentConversationMessage, 'id' | 'timestamp'>) =>
    set((s) => ({
      agentConversation: [
        ...s.agentConversation,
        { ...msg, id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() },
      ],
    })),

  clearAgentConversation: () => set({ agentConversation: [] }),

  clearMessages: () => set({ messages: [] }),
  clearChat: () => {
    // 只保存新创建的未保存对话；从历史加载的会话不再重复保存
    const state = useChatStore.getState()
    if (state.messages.length > 0 && state.currentSessionId === null) {
      state.saveCurrentSession()
    }
    set({ messages: [], agentConversation: [], activeAgentId: null, isStreaming: false, currentSessionId: null })
    try { api.settings.setData(STORAGE_KEY, JSON.stringify([])) } catch { /* skip */ }
  },

  /** 保存当前对话为会话记录 */
  saveCurrentSession: () => {
    const state = useChatStore.getState()
    if (state.messages.length === 0) return
    const firstUserMsg = state.messages.find((m) => m.role === 'user')
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : '新对话'
    const id = `session-${Date.now()}`
    const session: ChatSession = {
      id,
      title,
      timestamp: Date.now(),
      messageCount: state.messages.length,
      activeAgentId: state.activeAgentId,
    }
    const sessions = [session, ...state.sessions].slice(0, 50)
    try {
      api.settings.setData(`session_${id}`, JSON.stringify({
        messages: state.messages.slice(-MAX_HISTORY),
        agentConversation: state.agentConversation,
      }))
      api.settings.setData(SESSIONS_KEY, JSON.stringify(sessions))
    } catch { /* skip */ }
    set({ sessions })
  },

  /** 切换到指定会话 */
  switchToSession: async (id) => {
    const state = useChatStore.getState()
    // 只保存新创建的未保存对话；从历史加载的会话不再重复保存
    if (state.messages.length > 0 && state.currentSessionId === null) {
      state.saveCurrentSession()
    }
    try {
      const raw = await api.settings.getData(`session_${id}`)
      if (raw) {
        const data = JSON.parse(raw)
        const session = state.sessions.find((s) => s.id === id)
        set({
          messages: data.messages || [],
          agentConversation: data.agentConversation || [],
          activeAgentId: session?.activeAgentId || null,
          currentSessionId: id,
        })
        // 持久化当前消息
        try { api.settings.setData(STORAGE_KEY, JSON.stringify(data.messages || [])) } catch { /* skip */ }
      }
    } catch { /* skip */ }
  },

  /** 删除指定会话 */
  deleteSession: (id) => {
    const state = useChatStore.getState()
    const sessions = state.sessions.filter((s) => s.id !== id)
    try {
      api.settings.setData(`session_${id}`, JSON.stringify(null))
      api.settings.setData(SESSIONS_KEY, JSON.stringify(sessions))
    } catch { /* skip */ }
    set({ sessions })
  },
  setIsStreaming: (v) => set({ isStreaming: v }),
  setActiveAgent: (id) => set({ activeAgentId: id }),
  setAbortController: (c) => set({ abortController: c }),
  stopGeneration: () => {
    const state = useChatStore.getState()
    state.abortController?.abort()
    set({ abortController: null, isStreaming: false })
  },

  /** 持久化消息到本地存储 */
  persistMessages: () => {
    const state = useChatStore.getState()
    const recent = state.messages.slice(-MAX_HISTORY)
    try {
      api.settings.setData(STORAGE_KEY, JSON.stringify(recent))
    } catch {
      // 存储失败，忽略
    }
  },

  /** 从本地存储恢复消息和会话 */
  restoreMessages: async () => {
    try {
      const raw = await api.settings.getData(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const messages = parsed.filter((m: any) =>
            m && typeof m === 'object' && typeof m.id === 'string' && typeof m.content === 'string'
          )
          set({ messages })
        }
      }
    } catch { /* skip */ }
    // 恢复会话列表
    try {
      const raw = await api.settings.getData(SESSIONS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          set({ sessions: parsed })
        }
      }
    } catch { /* skip */ }
  },
}))
