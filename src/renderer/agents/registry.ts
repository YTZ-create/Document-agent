import { BaseAgent, type AgentConfig } from './base'
import { FileAnalyzerAgent } from './fileAnalyzer'
import { CodeReviewerAgent } from './codeReviewer'
import { DocSummarizerAgent } from './docSummarizer'
import { FileOrganizerAgent } from './fileOrganizer'
import { FormFillerAgent } from './formFiller'
import { LeaderAgent } from './leader'
import { MemoryAgent } from './memoryAgent'
import type { PlatformAPI } from '../api/platformAPI'
import type { MemoryStore } from '../memory/memoryStore'

class AgentRegistry {
  private agents = new Map<string, BaseAgent>()

  constructor(platform: PlatformAPI, memoryStore?: MemoryStore) {
    this.register(new FileAnalyzerAgent(platform))
    this.register(new CodeReviewerAgent(platform))
    this.register(new DocSummarizerAgent(platform))
    this.register(new FileOrganizerAgent(platform))
    this.register(new FormFillerAgent(platform))
    if (memoryStore) {
      this.register(new MemoryAgent(platform, memoryStore))
    }
    // LeaderAgent 最后注册，因为它依赖其他 Agent，可选注入 memoryStore
    this.register(new LeaderAgent(platform, memoryStore))
  }

  register(agent: BaseAgent) { this.agents.set(agent.config.id, agent) }
  getAll(): AgentConfig[] { return [...this.agents.values()].map((a) => a.config) }
  get(id: string) { return this.agents.get(id) }
  getConfig(id: string) { return this.agents.get(id)?.config }
}

// 向后兼容模块级单例
let _registry: AgentRegistry | null = null

export function createAgentRegistry(platform: PlatformAPI, memoryStore?: MemoryStore): AgentRegistry {
  _registry = new AgentRegistry(platform, memoryStore)
  return _registry
}

export function getAgentRegistry(): AgentRegistry {
  if (!_registry) throw new Error('AgentRegistry not initialized. Call createAgentRegistry(platform) first.')
  return _registry
}

export const agentRegistry = new Proxy({} as AgentRegistry, {
  get(_target, prop, receiver) {
    const r = _registry
    const val = r ? (r as any)[prop] : undefined
    // 未初始化时返回安全默认值，避免组件渲染时报错
    if (!r) {
      if (prop === 'getAll') return () => []
      if (prop === 'get') return () => undefined
      if (prop === 'getConfig') return () => undefined
      if (prop === 'register') return () => { throw new Error('Registry not initialized') }
      return undefined
    }
    // 如果是函数，绑定正确的 this
    if (typeof val === 'function') return val.bind(r)
    return val
  },
})
