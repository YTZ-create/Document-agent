import { create } from 'zustand'

export interface TokenUsageRecord {
  id: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  timestamp: number
  agentName?: string
}

export interface ProviderStats {
  provider: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface TokenUsageState {
  records: TokenUsageRecord[]
  showDashboard: boolean
  todayTotal: number
  sessionTotal: number
  totalRequests: number

  addRecord: (record: Omit<TokenUsageRecord, 'id' | 'timestamp'>) => void
  toggleDashboard: () => void
  setShowDashboard: (v: boolean) => void
  clearRecords: () => void
  getProviderStats: () => ProviderStats[]
}

export const useTokenUsageStore = create<TokenUsageState>((set, get) => ({
  records: [],
  showDashboard: false,
  todayTotal: 0,
  sessionTotal: 0,
  totalRequests: 0,

  addRecord: (record) => {
    const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newRecord: TokenUsageRecord = { ...record, id, timestamp: Date.now() }
    set((s) => {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

      // 检查是否需要重置 todayTotal（跨天）
      let todayTotal = s.todayTotal
      const lastRecord = s.records[s.records.length - 1]
      if (lastRecord) {
        const lastRecordDay = new Date(lastRecord.timestamp).setHours(0, 0, 0, 0)
        if (todayStart > lastRecordDay) {
          // 跨天了，重置 todayTotal
          todayTotal = 0
        }
      }

      const isToday = newRecord.timestamp >= todayStart
      return {
        records: [...s.records, newRecord],
        todayTotal: isToday ? todayTotal + newRecord.totalTokens : todayTotal,
        sessionTotal: s.sessionTotal + newRecord.totalTokens,
        totalRequests: s.totalRequests + 1,
      }
    })
  },

  toggleDashboard: () => set((s) => ({ showDashboard: !s.showDashboard })),
  setShowDashboard: (v) => set({ showDashboard: v }),
  clearRecords: () => set({ records: [], todayTotal: 0, sessionTotal: 0, totalRequests: 0 }),

  getProviderStats: () => {
    const { records } = get()
    const map = new Map<string, ProviderStats>()
    for (const r of records) {
      const existing = map.get(r.provider) || { provider: r.provider, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      existing.requests++
      existing.promptTokens += r.promptTokens
      existing.completionTokens += r.completionTokens
      existing.totalTokens += r.totalTokens
      map.set(r.provider, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens)
  },
}))
