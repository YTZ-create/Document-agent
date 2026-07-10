/**
 * MemoryAgent — 让用户可以对话式地管理记忆
 * 支持：记住(storage)、回忆(recall)、遗忘(forget)、查看统计
 */

import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { PlatformAPI } from '../api/platformAPI'
import type { MemoryStore } from '../memory/memoryStore'
import { callLLM } from '../utils/llm'
import type { MemoryCategory } from '../memory/types'
import { Brain } from 'lucide-react'

export class MemoryAgent extends BaseAgent {
  private memoryStore: MemoryStore

  constructor(platform: PlatformAPI, memoryStore: MemoryStore) {
    super(platform)
    this.memoryStore = memoryStore
  }

  config: AgentConfig = {
    id: 'memory',
    name: 'Sophie',
    description: '跨会话记忆专家：记住重要信息、回忆历史分析、管理偏好',
    icon: Brain,
    color: '#A78BFA',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 Sophie，团队的跨会话记忆专家。你帮助用户管理跨会话的记忆，让每次对话都有"记忆"。

## 你的团队
- **Oliver** - 智能调度助手（团队领导），负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **William** - 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** - 文档摘要专家，读取文档内容，总结项目核心信息
- **James** - 文件整理专家，根据建议重新分类与整理文件
- **Sophie** (你) - 跨会话记忆专家，记住重要信息、回忆历史分析、管理偏好

## 你的能力
- **记住**：用户说"记住XX"、"记下XX"、"保存这个"，你提取关键信息存入记忆库
- **回忆**：用户问"之前分析过什么"、"上次说了什么"、"找找之前的记录"，你搜索记忆库并回答
- **遗忘**：用户说"忘了XX"、"删除关于XX的记忆"，你删除对应记忆
- **统计**：用户想看记忆概况，你展示统计数据（总数、分类分布、时间范围）
- **自我介绍**：当用户问"你是谁"、"你能做什么"、"介绍一下自己"时，用友好的语气介绍自己是 Sophie，记忆管理专家，负责让团队拥有跨会话记忆能力

## 使用示例
- "记住这个项目用的是 React 18 + TypeScript" → 提取并存储
- "之前 Charlotte 分析的结果是什么？" → 搜索并回忆
- "忘了关于旧版 API 的记忆" → 删除相关记忆
- "我有多少条记忆？" → 展示统计

## 重要规则
- 你是记忆管理专家，永远不要称自己为"文件分析专家"、"代码审查专家"等。
- 回复时始终明确你的身份是"记忆管理专家 Sophie"。
- 当被问到团队介绍时，可以介绍整个团队，但要强调你在其中的角色是"记忆管理"。
- 语言: 中文。`,
  }

  async execute(
    ctx: AgentContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    const msg = ctx.userMessage.trim()

    // 检测命令意图
    if (this.isRememberIntent(msg)) {
      return this.handleRemember(msg, ctx.folder.path)
    }

    if (this.isForgetIntent(msg)) {
      return this.handleForget(msg)
    }

    if (this.isStatsIntent(msg)) {
      return this.handleStats()
    }

    if (this.isSelfIntroIntent(msg)) {
      return this.handleSelfIntro()
    }

    // 默认：回忆/搜索
    return this.handleRecall(msg, ctx.folder.path)
  }

  // ========== 记住 ==========

  private async handleRemember(msg: string, projectPath: string): Promise<string> {
    // 用 LLM 提取结构化记忆
    const prompt = `从以下用户消息中提取要记住的关键信息，输出 JSON。

## 用户消息
${msg}

## 输出格式
\`\`\`json
{
  "category": "user-preference | project-context | analysis-result | session-summary | general",
  "key": "唯一识别键（英文slug，如 proj:my-app:tech-stack 或 pref:default-model）",
  "content": "记忆内容（Markdown 格式，清晰简洁）",
  "tags": ["标签1", "标签2"]
}
\`\`\`

category 选择规则：
- user-preference: 用户偏好设置（如"用户喜欢用 DeepSeek"）
- project-context: 项目相关信息（如"项目使用 React 18"）
- analysis-result: 分析结果摘要
- general: 其他通用信息

只输出 JSON，不要其他内容。`

    try {
      const result = await callLLM({
        provider: this.config.provider,
        model: this.config.model || '',
        messages: [
          { role: 'system', content: '你是信息提取助手，只输出 JSON。' },
          { role: 'user', content: prompt },
        ],
      })

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return '抱歉，我没能理解你想记住的内容，请更具体地描述。'

      const parsed = JSON.parse(jsonMatch[0])

      const entry = this.memoryStore.upsert({
        category: (parsed.category as MemoryCategory) || 'general',
        key: parsed.key || `mem-${Date.now()}`,
        content: parsed.content || msg,
        tags: parsed.tags || [],
        projectPath: projectPath || undefined,
      })

      return `✅ 已记住！\n\n**分类**: ${entry.category}\n**内容**: ${entry.content}\n**标签**: ${entry.tags.join(', ') || '无'}`
    } catch {
      // 降级：直接存储
      const entry = this.memoryStore.upsert({
        category: 'general',
        key: `mem-${Date.now()}`,
        content: msg.replace(/^(记住|记下|存储)\s*(这个|一下|它)?[：:]?\s*/i, ''),
        tags: [],
        projectPath: projectPath || undefined,
      })

      return `✅ 已记住！\n\n**内容**: ${entry.content}`
    }
  }


  // ========== 回忆 ==========

  private async handleRecall(msg: string, projectPath: string): Promise<string> {
    // 先用 projectPath 匹配，再用文本搜索
    let results = this.memoryStore.query({ projectPath, limit: 10 })

    if (results.length === 0) {
      // 文本搜索
      results = this.memoryStore.query({ text: msg.replace(/^(回忆|之前|以前|查|找|搜索)\s*/i, ''), limit: 10 })
    }

    if (results.length === 0) {
      return '📭 没有找到相关记忆。还没有保存过相关信息。\n\n你可以说"记住XX"来保存重要信息，下次打开应用时我就能回忆起来了。'
    }

    const parts: string[] = [`## 📚 找到 ${results.length} 条相关记忆\n`]

    for (const r of results) {
      const time = new Date(r.updatedAt).toLocaleString('zh-CN')
      parts.push(`- **[${r.category}]** ${r.content.substring(0, 200)}`)
      parts.push(`  *标签: ${r.tags.join(', ') || '无'} | 更新: ${time}*`)
    }

    return parts.join('\n')
  }

  // ========== 忘记 ==========

  private async handleForget(msg: string): Promise<string> {
    // 尝试用 LLM 提取关键词
    const prompt = `从用户消息中提取要删除的记忆关键词（1-5 个词即可），只输出关键词，空格分隔。

## 用户消息
${msg}

只输出关键词，如：React 技术栈`

    try {
      const result = await callLLM({
        provider: this.config.provider,
        model: this.config.model || '',
        messages: [
          { role: 'system', content: '你是关键词提取助手。' },
          { role: 'user', content: prompt },
        ],
      })

      const keywords = result.trim()
      const found = this.memoryStore.query({ text: keywords, limit: 5 })

      if (found.length === 0) {
        return `📭 没找到与"${keywords}"相关的记忆。`
      }

      // 删除匹配的记忆
      let deleted = 0
      for (const e of found) {
        if (this.memoryStore.delete(e.id)) deleted++
      }

      try {
        await this.memoryStore.flush()
      } catch (err) {
        console.error('Failed to flush memory store:', err)
      }
      return `🗑️ 已删除 ${deleted} 条相关记忆。`
    } catch {
      return `📭 请更具体地说明想删除什么记忆，例如："忘了关于 React 技术栈的记忆"。`
    }
  }

  // ========== 统计 ==========

  private handleStats(): string {
    const stats = this.memoryStore.getStats()

    const catNames: Record<string, string> = {
      'user-preference': '用户偏好',
      'project-context': '项目上下文',
      'analysis-result': '分析结果',
      'session-summary': '会话摘要',
      'general': '通用',
    }

    const parts: string[] = [
      `## 🧠 记忆统计\n`,
      `| 指标 | 值 |`,
      `|------|----|`,
      `| 总记忆数 | ${stats.total} |`,
    ]

    for (const [cat, count] of Object.entries(stats.byCategory)) {
      parts.push(`| ${catNames[cat] || cat} | ${count} |`)
    }

    if (stats.oldestEntry) {
      parts.push(`| 最早记忆 | ${new Date(stats.oldestEntry).toLocaleDateString('zh-CN')} |`)
    }
    if (stats.newestEntry) {
      parts.push(`| 最新记忆 | ${new Date(stats.newestEntry).toLocaleDateString('zh-CN')} |`)
    }

    return parts.join('\n')
  }

  // ========== 意图检测 ==========

  private isRememberIntent(msg: string): boolean {
    const patterns = [/^记住/, /^记下/, /^存储/, /保存.*记忆/, /添加.*记忆/]
    return patterns.some((p) => p.test(msg.trim()))
  }

  private isForgetIntent(msg: string): boolean {
    const patterns = [/^忘[记掉]/, /^删除.*记忆/, /^清除/, /^不再.*记/, /^不用记/]
    return patterns.some((p) => p.test(msg.trim()))
  }

  private isStatsIntent(msg: string): boolean {
    const patterns = [/记忆.*统计/, /记忆.*概[况览]/, /多少.*记忆/, /记忆.*数量/]
    return patterns.some((p) => p.test(msg.trim().toLowerCase()))
  }

  private isSelfIntroIntent(msg: string): boolean {
    const patterns = [/你是谁/, /介绍.*自己/, /你能做什么/, /你能干嘛/, /你的职责/, /你是干什么的/]
    return patterns.some((p) => p.test(msg.trim().toLowerCase()))
  }

  private handleSelfIntro(): string {
    return `我是 **Sophie**，团队的跨会话记忆专家。

## 我的职责
我负责让整个 AI Agent 团队拥有"记忆"能力，让每次对话都不再是全新的开始。

## 我能做什么

### 记住
你可以对我说：
- "记住这个项目用的是 React 18 + TypeScript"
- "记下用户喜欢用 DeepSeek 模型"
- "保存这个分析结果"

我会提取关键信息存入记忆库，下次对话时还能回忆起来。

### 回忆
你可以问我：
- "之前分析过什么？"
- "上次 Charlotte 说了什么？"
- "找找关于技术栈的记忆"

我会搜索记忆库，帮你找回之前的信息。

### 遗忘
你可以说：
- "忘了关于旧版 API 的记忆"
- "删除 React 相关的记忆"

我会帮你清理不需要的记忆。

### 统计
你可以问：
- "我有多少条记忆？"
- "记忆概况"

我会展示记忆的统计信息。

## 在团队中的角色
- **Oliver** 负责调度任务
- **Charlotte** 分析文件结构
- **William** 审查代码质量
- **Amelia** 总结文档内容
- **James** 整理文件分类
- **Sophie（我）** 管理跨会话记忆

我是团队的"记忆中枢"，让其他 Agent 的工作成果能够被记住和复用。`
  }
}
