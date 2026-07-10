import { callLLM, callLLMStream } from '../utils/llm'
import type { FolderProject } from '../stores/folderStore'
import type { LucideIcon } from 'lucide-react'
import type { PlatformAPI } from '../api/platformAPI'
import { useTokenUsageStore } from '../stores/tokenUsageStore'
import { useSettingsStore } from '../stores/settingsStore'

export interface AgentConfig {
  id: string
  name: string
  description: string
  icon: LucideIcon
  color: string
  provider: string
  model?: string
  systemPrompt: string
}

export interface AgentContext {
  folder: FolderProject
  userMessage: string
  leaderContext?: string
  history?: { role: 'user' | 'agent'; content: string; agentName?: string }[]
  signal?: AbortSignal
  /** Phase 2: 知识库检索到的相关文件上下文 */
  knowledgeContext?: string
  /** Phase 5: 代码库依赖分析上下文 */
  codebaseContext?: string
}

export abstract class BaseAgent {
  abstract config: AgentConfig
  protected readonly platform: PlatformAPI

  constructor(platform: PlatformAPI) {
    this.platform = platform
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    const contextInfo = this.buildFolderContext(ctx.folder)
    let userContent = `## 当前文件夹信息\n${contextInfo}\n\n## 用户问题\n${ctx.userMessage}`
    if (ctx.leaderContext) {
      userContent += `\n\n## 调度助手分析\n${ctx.leaderContext}`
    }
    if (ctx.knowledgeContext) {
      userContent += `\n\n## 项目知识库检索结果\n${ctx.knowledgeContext}`
    }
    if (ctx.codebaseContext) {
      userContent += `\n\n## 代码库结构分析\n${ctx.codebaseContext}`
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: this.config.systemPrompt },
    ]

    // 添加对话历史（最近 10 轮）
    if (ctx.history && ctx.history.length > 0) {
      const recentHistory = ctx.history.slice(-20)
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        })
      }
    }

    messages.push({ role: 'user', content: userContent })

    try {
      const tokenUsageStore = useTokenUsageStore.getState()
      const settingsStore = useSettingsStore.getState()

      // 优先使用用户在设置中配置的模型，否则使用 Agent 默认配置
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''

      const onTokenUsage = (promptTokens: number, completionTokens: number) => {
        tokenUsageStore.addRecord({
          provider,
          model: model || 'default',
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          agentName: this.config.name,
        })
      }

      if (onToken) {
        return await callLLMStream({ provider, model, messages, signal: ctx.signal, onTokenUsage }, onToken)
      }
      return await callLLM({ provider, model, messages, onTokenUsage })
    } catch (err: any) {
      if (ctx.signal?.aborted) return ''
      return `❌ 调用失败: ${err.message}`
    }
  }

  protected buildFolderContext(folder: FolderProject): string {
    if (!folder.files) return `文件夹: ${folder.path}`
    const lines: string[] = [`文件夹路径: ${folder.path}`, `总文件数: ${folder.fileCount || 0}`, '目录结构:']

    const flatten = (entries: typeof folder.files, indent: number) => {
      for (const f of entries) {
        const prefix = '  '.repeat(indent)
        if (f.isDirectory) {
          const childCount = f.children?.length || 0
          lines.push(`${prefix}📁 ${f.name}/ (${childCount} 项)`)
          if (f.children) flatten(f.children, indent + 1)
        } else {
          const sizeStr = f.size > 1024 * 1024 ? `${(f.size / 1048576).toFixed(1)}MB` : f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`
          lines.push(`${prefix} ${f.name} (${sizeStr})`)
        }
      }
    }

    flatten(folder.files, 0)

    if (lines.length > 2000) {
      lines.splice(1800)
      lines.push(`  ... (还有更多文件)`)
    }
    return lines.join('\n')
  }
}
