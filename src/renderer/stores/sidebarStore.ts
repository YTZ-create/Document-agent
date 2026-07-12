import { create } from 'zustand'
import type { AgentConfig } from '../agents/base'

interface SidebarState {
  agentsCollapsed: boolean
  historyCollapsed: boolean
  agents: AgentConfig[]
  toggleAgentsCollapsed: () => void
  setAgentsCollapsed: (v: boolean) => void
  toggleHistoryCollapsed: () => void
  setHistoryCollapsed: (v: boolean) => void
  setAgents: (agents: AgentConfig[]) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  agentsCollapsed: false,
  historyCollapsed: false,
  agents: [],
  toggleAgentsCollapsed: () => set((s) => ({ agentsCollapsed: !s.agentsCollapsed })),
  setAgentsCollapsed: (v) => set({ agentsCollapsed: v }),
  toggleHistoryCollapsed: () => set((s) => ({ historyCollapsed: !s.historyCollapsed })),
  setHistoryCollapsed: (v) => set({ historyCollapsed: v }),
  setAgents: (agents) => set({ agents }),
}))
