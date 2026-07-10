import { create } from 'zustand'
import { api } from '../api/neutralino'

export interface ProviderConfig {
  id: string
  name: string
  color: string
  hasKey: boolean
}

export const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', color: '#10A37F', hasKey: false },
  { id: 'anthropic', name: 'Anthropic (Claude)', color: '#D97757', hasKey: false },
  { id: 'google', name: 'Google (Gemini)', color: '#4285F4', hasKey: false },
  { id: 'deepseek', name: 'DeepSeek', color: '#4D6BFE', hasKey: false },
  { id: 'zhipu', name: '智谱 (GLM)', color: '#3859FF', hasKey: false },
  { id: 'qwen', name: '通义千问', color: '#6B4EF7', hasKey: false },
  { id: 'moonshot', name: 'Moonshot', color: '#161823', hasKey: false },
]

export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
  zhipu: 'glm-4-flash',
  qwen: 'qwen-plus',
  moonshot: 'moonshot-v1-8k',
}

interface AgentModelConfig {
  agentId: string
  provider: string
  model: string
}

interface SettingsState {
  showSettings: boolean
  setShowSettings: (show: boolean) => void
  providers: ProviderConfig[]
  setProviderKey: (id: string, hasKey: boolean) => void
  refreshProviderKeys: () => Promise<void>
  /** Per-Agent 模型配置 */
  agentModels: AgentModelConfig[]
  setAgentModel: (agentId: string, provider: string, model: string) => void
  getAgentModel: (agentId: string) => { provider: string; model: string } | null
  loadAgentModels: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),
  providers: [...PROVIDERS],
  setProviderKey: (id, hasKey) =>
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, hasKey } : p)) })),
  refreshProviderKeys: async () => {
    const updated = await Promise.all(
      PROVIDERS.map(async (p) => {
        const key = await api.settings.getApiKey(p.id)
        return { ...p, hasKey: !!key }
      })
    )
    set({ providers: updated })
  },
  agentModels: [],
  setAgentModel: (agentId, provider, model) =>
    set((s) => {
      const filtered = s.agentModels.filter((m) => m.agentId !== agentId)
      const updated = [...filtered, { agentId, provider, model }]
      try { api.settings.setData('agent_models', JSON.stringify(updated)) } catch { /* skip */ }
      return { agentModels: updated }
    }),
  getAgentModel: (agentId) => {
    const found = get().agentModels.find((m) => m.agentId === agentId)
    return found ? { provider: found.provider, model: found.model } : null
  },
  loadAgentModels: async () => {
    try {
      const raw = await api.settings.getData('agent_models')
      if (raw) set({ agentModels: JSON.parse(raw) })
    } catch { /* skip */ }
  },
}))
