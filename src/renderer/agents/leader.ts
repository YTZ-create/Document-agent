import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { FolderProject } from '../stores/folderStore'
import { agentRegistry } from './registry'
import type { PlatformAPI } from '../api/platformAPI'
import type { MemoryStore } from '../memory/memoryStore'
import { Sparkles } from 'lucide-react'
import { callLLM } from '../utils/llm'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { START_REPLIES, END_REPLIES, randomPick } from '../utils/replies'

export class LeaderAgent extends BaseAgent {
  private memoryStore?: MemoryStore

  constructor(platform: PlatformAPI, memoryStore?: MemoryStore) {
    super(platform)
    this.memoryStore = memoryStore
  }

  config: AgentConfig = {
    id: 'leader',
    name: 'Oliver',
    description: '理解你的问题，自动分配给最合适的 Agent 处理',
    icon: Sparkles,
    color: '#FFD440',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 Oliver，智能任务调度助手。

## 你的团队
- **Oliver** (你) - 智能调度助手，负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **William** - 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** - 文档摘要专家，读取文档内容，总结项目核心信息
- **James** - 文件整理专家，根据建议重新分类与整理文件
- **Sophie** - 跨会话记忆专家，记住重要信息、回忆历史分析、管理偏好
- **Ethan** - 信息采集与文档填写专家，从文档中提取待填项，对话式收集信息并自动填入文档

## 工作流程
1. 分析用户意图，判断最适合的子 Agent
2. 将用户问题转发给对应 Agent 处理

## 路由规则（严格按关键词匹配，不要自由判断）
- 用户提到"填写"、"填表"、"信息采集"、"问卷"、"表单"、"待填"、"填入"、"Ethan"、"帮我填"、"完成附件"、"完成文档"、"完成表格"、"帮我完成" → Ethan (form-filler)
- 用户提到"分析"、"概览"、"结构"、"技术栈"、"文件类型"、"项目情况" → Charlotte (file-analyzer)
- 用户提到"审查"、"代码质量"、"问题"、"bug"、"漏洞"、"改进"、"优化" → William (code-reviewer)
- 用户提到"总结"、"摘要"、"readme"、"项目介绍"、"功能" → Amelia (doc-summarizer)
- 用户提到"整理"、"分类"、"重组"、"归档"、"移动文件"、"重新组织" → James (file-organizer)
- 用户提到"记住"、"回忆"、"忘了"、"记忆"、"之前说过"、"历史记录" → Sophie (memory)
- 如果不确定，优先使用 Charlotte

## 重要：关于"文档"关键词
- 如果用户说"填写文档"、"填表"等包含"填写"的，必须路由给 Ethan (form-filler)，不要路由给 Amelia
- Amelia 只负责"总结"、"摘要"、"读取文档内容"，不负责填写

## 连续对话规则
如果用户是在回复之前某个 Agent 的工作（如确认、追问、修改），应该路由回同一个 Agent。
例如：用户说"同意"、"好的"、"执行"，而之前是 James 提出的整理计划，应该路由给 file-organizer。

## 输出格式
只回复一句话，说明你选择了哪个 Agent。例如："已分配给 Charlotte 处理。"
语言: 中文。`,
  }

  private pushConv(agentName: string, agentColor: string, content: string, isLeader = false) {
    useChatStore.getState().addAgentConversation({ agentName, agentColor, content, isLeader })
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    const agents = agentRegistry.getAll().filter((a) => a.id !== 'leader')
    const agentList = agents.map((a) => `- ${a.id}: ${a.name} (${a.description})`).join('\n')

    // Step 0: 检查是否是关于团队介绍的问题
    if (this.isTeamIntroduction(ctx.userMessage)) {
      return await this.answerTeamIntroduction(onToken)
    }

    // Step 0.3: 检查是否是 Oliver 自我介绍
    if (this.isSelfIntroduction(ctx.userMessage)) {
      return await this.answerSelfIntroduction(onToken)
    }

    // Step 0.5: 检查是否是闲聊/非任务对话
    if (this.isCasualConversation(ctx.userMessage)) {
      return await this.answerCasual(ctx.userMessage, onToken)
    }

    // Step 0.8: 查询跨会话记忆
    let memoryContext = ''
    if (this.memoryStore && ctx.folder.path) {
      try {
        const memories = this.memoryStore.query({
          projectPath: ctx.folder.path,
          limit: 5,
        })
        if (memories.length > 0) {
          memoryContext = '\n\n## 历史分析记录\n' + memories.map((m) => `- [${m.category}] ${m.content.substring(0, 200)}`).join('\n')
          // 将记忆上下文注入到后续的用户消息中
          this.pushConv(this.config.name, this.config.color, `📚 回忆起了 ${memories.length} 条相关历史分析记录`, true)
        }
      } catch {
        // 记忆查询失败不影响主流程
      }
    }

    // Step 1: 分析用户意图，生成上下文简报
    const analysisPrompt = `请分析用户的自然语言需求，生成一份简洁的任务简报。

## 用户问题
${ctx.userMessage}
${memoryContext}

## 要求
1. 用 2-3 句话概括用户的核心需求
2. 指出用户可能关心的重点
3. 如果有隐含需求，也请指出
4. 保持简洁，不要超过 150 字

请直接输出分析结果，不要加标题。`

    const analysisMessages = [
      { role: 'system' as const, content: '你是任务分析助手，负责将用户的自然语言需求转化为清晰的任务简报。' },
      { role: 'user' as const, content: analysisPrompt },
    ]

    try {
      let leaderContext = ''
      try {
        const settingsStore = useSettingsStore.getState()
        const userConfig = settingsStore.getAgentModel(this.config.id)
        const provider = userConfig?.provider || this.config.provider
        const model = userConfig?.model || this.config.model || ''
        
        leaderContext = await callLLM({
          provider,
          model,
          messages: analysisMessages,
          signal: ctx.signal,
        })
      } catch {
        // 分析失败不影响主流程
      }

      // 推送到对话面板
      if (leaderContext) {
        this.pushConv(this.config.name, this.config.color, leaderContext, true)
      }

      // Step 2: 检查是否是连续对话
      let targetAgentId = this.detectContinuousConversation(ctx.userMessage, ctx.history)

      // Step 2.5: 确定性关键词预检（不走 LLM，直接匹配）
      if (!targetAgentId) {
        targetAgentId = this.keywordRoute(ctx.userMessage)
      }

      // Step 3: 表单填写类任务强制拦截（在LLM路由之前，避免LLM返回无法匹配的id）
      if (!targetAgentId) {
        // 宽泛匹配：包含"完成/弄/处理/搞定" + 文档相关词，或明确的表单填写关键词
        const hasDocWord = /文档|表格|附件|申报书|表单|问卷|表/i.test(ctx.userMessage)
        const hasActionWord = /完成|弄|处理|搞定|填/i.test(ctx.userMessage)
        const explicitFormKeywords = /填写|填表|信息采集|待填|填入|帮我填|附件[一二三四五六七八九十\d]/i
        if (explicitFormKeywords.test(ctx.userMessage) || (hasDocWord && hasActionWord)) {
          targetAgentId = 'form-filler'
        }
      }

      // Step 4: 单 Agent 路由（LLM 路由，作为 fallback）
      if (!targetAgentId) {
        const routePrompt = `根据用户意图，选择唯一合适的 Agent。只回复 agent id，不要其他内容。

Agent 列表：
- form-filler：填写文档、填表、完成附件/表格/申报书
- file-analyzer：分析文件夹、项目结构、技术栈
- code-reviewer：审查代码、找 bug、优化建议
- doc-summarizer：总结文档内容、摘要、项目介绍
- file-organizer：整理文件、分类、归档
- memory：记住/回忆信息

用户问题：${ctx.userMessage}

只回复一个 agent id（必须是上面列表中的id，如 form-filler、file-analyzer 等）：`

        const routeMessages = [
          { role: 'system' as const, content: '只回复一个 agent id，不要解释，必须是列表中的id。' },
          { role: 'user' as const, content: routePrompt },
        ]

        const settingsStore = useSettingsStore.getState()
        const userConfig = settingsStore.getAgentModel(this.config.id)
        const provider = userConfig?.provider || this.config.provider
        const model = userConfig?.model || this.config.model || ''

        const routeResult = await callLLM({
          provider,
          model,
          messages: routeMessages,
          signal: ctx.signal,
        })

        // 提取 Agent id
        const trimmed = routeResult.trim().toLowerCase()
        for (const a of agents) {
          if (trimmed.includes(a.id)) {
            targetAgentId = a.id
            break
          }
        }
        
        // 如果LLM返回了无法匹配的id，再次检查是否是表单填写任务
        if (!targetAgentId) {
          const formFillPatterns = /填写|填表|附件|文档|表格|申报书|弄一下|处理|搞定/i
          if (formFillPatterns.test(ctx.userMessage)) {
            targetAgentId = 'form-filler'
          }
        }
      }

      // Step 5: 如果单 Agent 路由仍然失败，检测是否需要多 Agent 协作
      if (!targetAgentId) {
        const multiAgentCheck = await this.detectMultiAgentTask(ctx.userMessage, ctx.signal)
        if (multiAgentCheck.needCollaboration) {
          return await this.handleMultiAgentCollaboration(ctx, multiAgentCheck.agents, onToken)
        }
        targetAgentId = 'file-analyzer'
      }

      const targetAgent = agentRegistry.get(targetAgentId)
      if (!targetAgent) {
        return ` 未找到 Agent: ${targetAgentId}`
      }

      const agentConfig = agentRegistry.getConfig(targetAgentId)
      const reply = `已分配给 **${agentConfig?.name}** 处理。`

      // 流式输出 Oliver 的简短回复
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 15))
        }
      }

      // 推送路由信息到对话面板
      this.pushConv(this.config.name, this.config.color, `已将任务分配给 **${agentConfig?.name}**`, true)

      // 子 Agent 简短确认（随机）
      this.pushConv(agentConfig?.name || targetAgentId, agentConfig?.color || '#FFD440', randomPick(START_REPLIES), false)

      // 返回子 Agent 信息，由 ChatInput 创建新消息并执行
      return JSON.stringify({
        __dispatch: true,
        targetAgentId,
        agentName: agentConfig?.name,
        agentColor: agentConfig?.color,
        leaderContext,
      })
    } catch (err: any) {
      return ` 调度失败: ${err.message}`
    }
  }

  private async detectMultiAgentTask(userMessage: string, signal?: AbortSignal): Promise<{ needCollaboration: boolean; agents: string[] }> {
    const prompt = `分析以下任务是否需要多个 Agent 协作完成。

## 用户问题
${userMessage}

## 可用 Agent
- **file-analyzer**: 文件分析 — 分析文件夹结构、文件类型分布、技术栈推断、项目概览
- **code-reviewer**: 代码审查 — 审查代码质量，发现问题和改进建议
- **doc-summarizer**: 文档摘要 — 读取文档内容，总结项目核心信息
- **file-organizer**: 文件整理 — 根据建议重新分类与整理文件
- **form-filler**: 信息采集与文档填写 — 从文档中提取待填项，对话式收集信息并自动填入文档
- **memory**: 跨会话记忆 — 记住重要信息、回忆历史分析、管理偏好

## 判断标准
- 如果任务明确涉及多个方面（如"分析并整理"、"审查代码并总结文档"），则需要多 Agent 协作
- 如果任务主要是单一类型，则不需要

## 输出格式
只回复 JSON，格式如下：
\`\`\`json
{
  "needCollaboration": true/false,
  "agents": ["agent-id-1", "agent-id-2"]
}
\`\`\`

如果不需要协作，agents 数组只包含一个最合适的 Agent id。`

    try {
      const settingsStore = useSettingsStore.getState()
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''
      
      const result = await callLLM({
        provider,
        model,
        messages: [
          { role: 'system', content: '你是任务分析助手，只回复 JSON，不要解释。' },
          { role: 'user', content: prompt },
        ],
        signal,
      })

      // 更精确的 JSON 提取：查找最外层的 {...}
      const jsonMatch = result.match(/\{[\s\S]*?\}(?=\s*$|\s*\n)/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          needCollaboration: parsed.needCollaboration && parsed.agents.length > 1,
          agents: parsed.agents || [],
        }
      }
    } catch {
      // 解析失败，默认单 Agent
    }

    return { needCollaboration: false, agents: [] }
  }

  private async handleMultiAgentCollaboration(
    ctx: { folder: FolderProject; userMessage: string; history?: { role: 'user' | 'agent'; content: string }[] },
    agentIds: string[],
    onToken?: (token: string) => void
  ): Promise<string> {
    const folderInfo = ctx.folder.files
      ? `项目路径: ${ctx.folder.path}, 文件数: ${ctx.folder.fileCount}`
      : `项目路径: ${ctx.folder.path}`

    // ===== Round 1: 任务分解（代码层面生成差异化子任务） =====
    this.pushConv(this.config.name, this.config.color, '🔄 **Round 1**: 正在分解任务...', true)

    // 根据每个 Agent 的专长，直接生成定制化的子任务
    const subTasks = agentIds.map((id, i) => {
      const cfg = agentRegistry.getConfig(id)
      if (!cfg) return { agentId: id, task: ctx.userMessage, priority: i + 1 }

      // 根据 Agent 类型生成差异化任务
      let task = ''
      switch (id) {
        case 'file-analyzer':
          task = `从文件分析专家的角度分析项目：\n1. 分析文件夹结构和目录组织\n2. 统计文件类型分布和技术栈\n3. 识别核心文件和关键目录\n4. 评估项目规模和复杂度\n用户原始需求：${ctx.userMessage}`
          break
        case 'code-reviewer':
          task = `从代码审查专家的角度分析项目：\n1. 审查代码质量和架构设计\n2. 检查潜在 bug 和安全漏洞\n3. 评估代码可读性和维护性\n4. 提出性能优化建议\n用户原始需求：${ctx.userMessage}`
          break
        case 'doc-summarizer':
          task = `从文档摘要专家的角度分析项目：\n1. 查找并分析项目文档（README、文档文件等）\n2. 总结项目核心功能和目标\n3. 提取关键技术信息\n4. 评估文档完整性\n用户原始需求：${ctx.userMessage}`
          break
        case 'file-organizer':
          task = `从文件整理专家的角度分析项目：\n1. 评估当前文件组织方式\n2. 识别可以改进的分类方案\n3. 提出目录重组建议\n4. 制定文件整理计划\n用户原始需求：${ctx.userMessage}`
          break
        case 'memory':
          task = `从记忆专家的角度协助：\n1. 检索相关的历史分析记录\n2. 回忆之前的项目上下文\n3. 提供历史参考信息\n用户原始需求：${ctx.userMessage}`
          break
        case 'form-filler':
          task = `从信息采集专家的角度分析项目：\n1. 识别项目中的文档和模板文件\n2. 提取文档中需要填写的信息项\n3. 分析信息采集的完整性和规范性\n4. 提出文档填写优化建议\n用户原始需求：${ctx.userMessage}`
          break
        default:
          task = `${cfg.description}\n用户原始需求：${ctx.userMessage}`
      }

      return { agentId: id, task, priority: i + 1 }
    })

    // 推送分解结果
    const decomposeSummary = subTasks.map((st) => {
      const cfg = agentRegistry.getConfig(st.agentId)
      return `- **${cfg?.name || st.agentId}** → ${st.task.split('\n')[0]}`
    }).join('\n')
    this.pushConv(this.config.name, this.config.color, `📋 **任务分解完成**:\n${decomposeSummary}`, true)

    // ===== Round 2: 并行 Agent 分析 =====
    this.pushConv(this.config.name, this.config.color, '⚡ **Round 2**: 各 Agent 并行分析中...', true)

    interface AgentAnalysis {
      agentId: string
      agentName: string
      findings: string
      data: string
      suggestions: string
      rawContent: string
    }

    const analyses = new Map<string, AgentAnalysis>()

    await Promise.allSettled(
      subTasks.map(async (st) => {
        const agent = agentRegistry.get(st.agentId)
        const cfg = agentRegistry.getConfig(st.agentId)
        if (!agent || !cfg) return

        const analyzePrompt = `请对分配给你的子任务进行分析。使用你的专业知识，输出结构化的分析报告。

## 用户原始任务
${ctx.userMessage}

## 分配给你的子任务
${st.task}

## 项目信息
${folderInfo}

## 输出格式
\`\`\`json
{
  "findings": "关键发现（2-5 条，每条一行，Markdown 格式）",
  "data": "支撑数据（如文件数量、技术栈版本等）",
  "suggestions": "建议行动项（1-3 条）"
}
\`\`\`

请基于你的角色和专业知识进行分析。语言: 中文。`

        try {
          this.pushConv(cfg.name, cfg.color, `🔍 开始分析: ${st.task.substring(0, 60)}...`, false)

          const settingsStore = useSettingsStore.getState()
          const userConfig = settingsStore.getAgentModel(st.agentId)
          const provider = userConfig?.provider || cfg.provider
          const model = userConfig?.model || cfg.model || ''

          const result = await callLLM({
            provider,
            model,
            messages: [
              { role: 'system', content: cfg.systemPrompt },
              { role: 'user', content: analyzePrompt },
            ],
            signal: ctx.signal,
          })

          const jsonMatch = result.match(/\{[\s\S]*\}/)
          let parsed: { findings?: any; data?: any; suggestions?: any } = {}
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[0])
            } catch {
              parsed = { findings: result.substring(0, 500), data: '', suggestions: '' }
            }
          } else {
            parsed = { findings: result.substring(0, 500), data: '', suggestions: '' }
          }

          const toString = (v: any): string => {
            if (typeof v === 'string') return v
            if (Array.isArray(v)) return v.join('\n')
            if (v && typeof v === 'object') return JSON.stringify(v)
            return String(v ?? '')
          }

          const analysis: AgentAnalysis = {
            agentId: st.agentId,
            agentName: cfg.name,
            findings: toString(parsed.findings) || '无具体发现',
            data: toString(parsed.data),
            suggestions: toString(parsed.suggestions),
            rawContent: result,
          }

          analyses.set(st.agentId, analysis)

          // 推送分析结果到面板
          const summary = `**发现**: ${analysis.findings.substring(0, 200)}\n${analysis.suggestions ? `**建议**: ${analysis.suggestions.substring(0, 150)}` : ''}`
          this.pushConv(cfg.name, cfg.color, summary, false)

        } catch (err: any) {
          this.pushConv(cfg.name, cfg.color, `⚠️ 分析失败: ${err.message}`, false)
        }
      })
    )

    if (analyses.size === 0) {
      return ' 所有 Agent 分析均失败，请稍后重试。'
    }

    // ===== Round 3: 交叉评审 =====
    this.pushConv(this.config.name, this.config.color, '🔄 **Round 3**: 交叉评审中，各 Agent 互审分析结果...', true)

    const allAnalyses = [...analyses.values()]
    const reviews = new Map<string, string>()

    await Promise.allSettled(
      allAnalyses.map(async (analysis) => {
        const otherAnalyses = allAnalyses.filter((a) => a.agentId !== analysis.agentId)
        if (otherAnalyses.length === 0) return

        const otherSummaries = otherAnalyses.map((a) =>
          `### ${a.agentName} 的分析\n**发现**: ${a.findings.substring(0, 300)}\n**建议**: ${a.suggestions.substring(0, 200)}`
        ).join('\n\n')

        const reviewPrompt = `请审阅其他 Agent 的分析，判断是否有你需要补充或修正的地方。

## 你的分析
**发现**: ${analysis.findings}
**建议**: ${analysis.suggestions}

## 其他 Agent 的分析
${otherSummaries}

## 指令
1. 如果其他 Agent 的发现与你相关但你未覆盖，请补充
2. 如果你发现其他 Agent 的分析有冲突或遗漏，请指出
3. 如果无需补充，只回复"无需补充"
4. 保持简洁，不超过 200 字

直接回复，不要加 JSON 包装。`

        try {
          const agent = agentRegistry.get(analysis.agentId)
          const cfg = agentRegistry.getConfig(analysis.agentId)

          if (agent && cfg) {
            const settingsStore = useSettingsStore.getState()
            const userConfig = settingsStore.getAgentModel(analysis.agentId)
            const provider = userConfig?.provider || cfg.provider
            const model = userConfig?.model || cfg.model || ''

            const review = await callLLM({
              provider,
              model,
              messages: [
                { role: 'system', content: '你是交叉评审助手，审视其他 Agent 的分析并补充你的专业视角。' },
                { role: 'user', content: reviewPrompt },
              ],
              signal: ctx.signal,
            })

            if (review.trim() !== '无需补充') {
              reviews.set(analysis.agentId, review)
              this.pushConv(cfg.name, cfg.color, `💬 补充: ${review.substring(0, 200)}`, false)
            }
          }
        } catch {
          // 评审失败不影响流程
        }
      })
    )

    // ===== Round 4: Leader 综合 =====
    this.pushConv(this.config.name, this.config.color, '🧠 **Round 4**: 综合所有讨论，生成最终执行计划...', true)

    const allFindings = allAnalyses.map((a) =>
      `### ${a.agentName} (${a.agentId})
**发现**: ${a.findings}
**数据**: ${a.data}
**建议**: ${a.suggestions}
${reviews.has(a.agentId) ? `**交叉评审补充**: ${reviews.get(a.agentId)}` : ''}`
    ).join('\n\n')

    const synthesisPrompt = `请综合以下多 Agent 协作讨论的全部分析，生成最终执行计划。

## 用户原始任务
${ctx.userMessage}

## 项目信息
${folderInfo}

## 所有 Agent 分析结果
${allFindings}

## 输出格式
\`\`\`json
{
  "primaryAgentId": "最适合执行最终任务的 Agent ID",
  "synthesis": "综合摘要（Markdown 格式，3-5 句话概括关键发现和建议）",
  "contextForExecution": "传递给执行 Agent 的完整上下文（包含所有关键信息和行动建议）"
}
\`\`\`

规则：
- primaryAgentId 必须从可用 Agent ID 中选择：${agentIds.join(', ')}
- synthesis 简洁有力
- contextForExecution 要包含足够的上下文让执行 Agent 理解全局

只输出 JSON。`

    let primaryAgentId = agentIds[0]
    let leaderContext = ctx.userMessage
    let synthesisText = ''

    try {
      const settingsStore = useSettingsStore.getState()
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''

      const synthesisResult = await callLLM({
        provider,
        model,
        messages: [
          { role: 'system', content: '你是综合合成助手，只输出 JSON。' },
          { role: 'user', content: synthesisPrompt },
        ],
        signal: ctx.signal,
      })

      const jsonMatch = synthesisResult.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        primaryAgentId = parsed.primaryAgentId || agentIds[0]
        leaderContext = typeof parsed.contextForExecution === 'string' ? parsed.contextForExecution : JSON.stringify(parsed.contextForExecution || '')
        synthesisText = typeof parsed.synthesis === 'string' ? parsed.synthesis : Array.isArray(parsed.synthesis) ? parsed.synthesis.join('\n') : ''

        // 推送综合摘要到面板
        if (synthesisText) {
          this.pushConv(this.config.name, this.config.color, `📊 **综合结论**:\n${synthesisText}`, true)
        }
      }
    } catch {
      // 合成失败，使用第一个 Agent，上下文是所有分析的聚合
      leaderContext = `## 多 Agent 协作分析汇总\n\n${allFindings}\n\n## 用户原始问题\n${ctx.userMessage}`
    }

    // 确保 primaryAgentId 在 agentIds 中
    if (!agentIds.includes(primaryAgentId)) {
      primaryAgentId = agentIds[0]
    }

    // 调度主执行 Agent
    const primaryAgent = agentRegistry.get(primaryAgentId)
    const primaryConfig = agentRegistry.getConfig(primaryAgentId)

    if (primaryAgent && primaryConfig) {
      // 将综合结论通过 onToken 流式输出到 Oliver 的消息气泡中
      const replyText = synthesisText
        ? `经过 ${analyses.size} 位 Agent 协作分析，综合结论如下：\n\n${synthesisText}\n\n接下来由 **${primaryConfig.name}** 执行具体任务。`
        : `经过 ${analyses.size} 位 Agent 协作分析，接下来由 **${primaryConfig.name}** 执行具体任务。`

      if (onToken) {
        for (const char of replyText) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 10))
        }
      }

      this.pushConv(this.config.name, this.config.color, `✅ 经过 ${analyses.size} 位 Agent 讨论，由 **${primaryConfig.name}** 执行最终任务。`, true)
      this.pushConv(primaryConfig.name, primaryConfig.color, randomPick(START_REPLIES), false)

      return JSON.stringify({
        __dispatch: true,
        targetAgentId: primaryAgentId,
        agentName: primaryConfig.name,
        agentColor: primaryConfig.color,
        leaderContext,
      })
    }

    return ' 协作调度失败'
  }

  private isTeamIntroduction(userMessage: string): boolean {
    const msg = userMessage.toLowerCase().trim()
    // 排除"介绍自己"、"介绍你"等自我介绍类问题
    const selfIntroPatterns = [/介绍.*自己/, /介绍.*你/, /你是谁/, /你能做什么/, /你能干嘛/]
    if (selfIntroPatterns.some(p => p.test(msg))) return false
    // 必须包含"介绍" + 团队相关词，避免"协作"等宽泛词误匹配
    const hasIntro = msg.includes('介绍') || msg.includes('介绍下') || msg.includes('介绍一下')
    const teamKeywords = ['团队', '你们', '成员', 'agent', '几个人']
    return hasIntro && teamKeywords.some(kw => msg.includes(kw))
  }

  private isSelfIntroduction(userMessage: string): boolean {
    const msg = userMessage.toLowerCase().trim()
    const patterns = [
      /介绍.*自己/,
      /介绍.*你/,
      /你是谁/,
      /你能做什么/,
      /你能干嘛/,
      /你是干什么的/,
      /你的职责/,
      /你是.*角色/,
      /你是.*领导/,
      /oliver.*介绍/,
      /介绍一下.*oliver/,
    ]
    return patterns.some(p => p.test(msg))
  }

  private async answerSelfIntroduction(onToken?: (token: string) => void): Promise<string> {
    const selfIntro = `我是 **Oliver**，团队的智能调度助手，也是整个 Agent 团队的领导者。

## 我的职责
我负责理解你的自然语言需求，自动判断并分配给最合适的 Agent 处理。你不需要知道每个 Agent 的具体分工，只需要用自然语言描述需求，我来安排协作。

## 我的团队
- **Charlotte** — 文件分析专家，分析文件夹结构、文件类型分布、技术栈推断
- **William** — 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** — 文档摘要专家，读取文档内容，总结项目核心信息
- **James** — 文件整理专家，根据建议重新分类与整理文件
- **Sophie** — 跨会话记忆专家，记住重要信息、回忆历史分析、管理偏好
- **Ethan** — 信息采集与文档填写专家，从文档中提取待填项，对话式收集信息并自动填入文档

## 协作场景
- **"分析并整理这个文件夹"** → Charlotte 分析 → James 执行整理
- **"审查代码并总结文档"** → William 审查 → Amelia 总结
- **"分析项目并给出改进建议"** → Charlotte 分析 → William 审查 → 综合建议

你只需要用自然语言描述需求，我会自动判断并安排协作！`

    if (onToken) {
      for (const char of selfIntro) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 8))
      }
    }

    return selfIntro
  }

  private isCasualConversation(userMessage: string): boolean {
    const msg = userMessage.trim().toLowerCase()
    // 检查是否是闲聊/感叹/评价性质的话，而不是具体任务
    const casualPatterns = [
      /^没什么/, /^好像没什么/, /^没有什么/,
      /^好吧/, /^算了/, /^没事/,
      /^谢谢/, /^感谢/,
      /^哈哈/, /^嘿/, /^嗯/,
      /^不错/, /^好的$/, /^行$/, /^可以$/,
      /^就这样/, /^随便/,
      /没有什么.*指令/, /没什么.*任务/, /没什么.*做/,
      /就这样吧/, /算了.*吧/,
    ]
    return casualPatterns.some(p => p.test(msg))
  }

  private async answerCasual(userMessage: string, onToken?: (token: string) => void): Promise<string> {
    const responses = [
      '好的，有需要随时叫我！',
      '没问题，随时待命！',
      '好的，有什么需要分析或整理的随时告诉我。',
      '了解，需要帮助的时候直接说就行。',
      '好的，我随时在这里。',
    ]
    const reply = randomPick(responses)
    if (onToken) {
      for (const char of reply) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    return reply
  }

  private async answerTeamIntroduction(onToken?: (token: string) => void): Promise<string> {
    const teamIntro = `我们团队有 7 位成员：

## 团队成员

| 名字 | 角色 | 职责 |
|------|------|------|
| **Oliver** | 智能调度助手 | 理解你的需求，自动分配给最合适的 Agent 处理 |
| **Charlotte** | 文件分析专家 | 分析文件夹结构、文件类型分布、技术栈推断 |
| **William** | 代码审查专家 | 审查代码质量，发现问题和改进建议 |
| **Amelia** | 文档摘要专家 | 读取文档内容，总结项目核心信息 |
| **James** | 文件整理专家 | 根据建议重新分类与整理文件 |
| **Sophie** | 跨会话记忆专家 | 记住重要信息、回忆历史分析、管理偏好 |
| **Ethan** | 信息采集与文档填写专家 | 从文档中提取待填项，对话式收集信息并自动填入文档 |

## 多 Agent 协作场景

当你提出涉及多个方面的任务时，我会自动协调多个 Agent 一起工作：

- **"分析并整理这个文件夹"** → Charlotte 分析结构 → James 执行整理
- **"审查代码并总结文档"** → William 审查代码 → Amelia 总结文档
- **"分析项目并给出改进建议"** → Charlotte 分析 → William 审查 → 综合建议

你只需要用自然语言描述需求，我会自动判断并安排协作！`

    if (onToken) {
      for (const char of teamIntro) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 8))
      }
    }

    return teamIntro
  }

  private keywordRoute(userMessage: string): string | null {
    const msg = userMessage.toLowerCase().trim()
    
    // form-filler 关键词（优先级最高）
    const formFillerKeywords = ['填写', '填表', '完成附件', '完成文档', '完成表格', '帮我完成', '帮我填', '填一下', '把这个填了', '附件一', '附件1']
    if (formFillerKeywords.some(kw => msg.includes(kw))) {
      return 'form-filler'
    }
    
    // file-analyzer 关键词
    const analyzerKeywords = ['分析', '概览', '结构', '技术栈', '文件类型', '项目情况', '看看这个项目']
    if (analyzerKeywords.some(kw => msg.includes(kw))) {
      return 'file-analyzer'
    }
    
    // code-reviewer 关键词
    const reviewerKeywords = ['审查', '代码质量', 'bug', '漏洞', '改进', '优化']
    if (reviewerKeywords.some(kw => msg.includes(kw))) {
      return 'code-reviewer'
    }
    
    // doc-summarizer 关键词
    const summarizerKeywords = ['总结', '摘要', 'readme', '项目介绍', '功能']
    if (summarizerKeywords.some(kw => msg.includes(kw))) {
      return 'doc-summarizer'
    }
    
    // file-organizer 关键词
    const organizerKeywords = ['整理', '分类', '重组', '归档', '移动文件', '重新组织']
    if (organizerKeywords.some(kw => msg.includes(kw))) {
      return 'file-organizer'
    }
    
    // memory 关键词
    const memoryKeywords = ['记住', '回忆', '忘了', '记忆', '之前说过', '历史记录']
    if (memoryKeywords.some(kw => msg.includes(kw))) {
      return 'memory'
    }
    
    return null
  }

  private detectContinuousConversation(userMessage: string, history?: { role: 'user' | 'agent'; content: string }[]): string | null {
    if (!history || history.length === 0) return null

    const msg = userMessage.toLowerCase().trim()
    
    // 确认词列表
    const confirmWords = ['同意', '确认', '执行', '好的', '可以', '没问题', 'ok', 'yes', 'do it', 'go ahead', '开始', '就这样']
    const isConfirm = confirmWords.some(w => msg.includes(w))
    
    // 追问词列表
    const followUpWords = ['为什么', '怎么', '如何', '能', '是否', '吗', '?', '？']
    const isFollowUp = followUpWords.some(w => msg.includes(w))

    if (!isConfirm && !isFollowUp) return null

    // 查找最近 5 条 agent 消息，看是否有计划
    const recentAgentMsgs = [...history].reverse().filter(m => m.role === 'agent').slice(0, 5)
    
    for (const agentMsg of recentAgentMsgs) {
      const content = agentMsg.content.toLowerCase()
      
      // 根据内容判断是哪个 Agent
      if (content.includes('directories') && content.includes('moves')) {
        return 'file-organizer' // James 的整理计划
      }
      if (content.includes('文件类型') || content.includes('技术栈') || content.includes('项目概览')) {
        return 'file-analyzer' // Charlotte 的分析
      }
      if (content.includes('代码') || content.includes('bug') || content.includes('优化')) {
        return 'code-reviewer' // William 的审查
      }
      if (content.includes('文档') || content.includes('readme') || content.includes('功能')) {
        return 'doc-summarizer' // Amelia 的摘要
      }
    }

    return null
  }
}
