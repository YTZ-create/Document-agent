import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { FolderProject } from '../stores/folderStore'
import type { PlatformAPI, FileEntry } from '../api/platformAPI'
import { FolderCog } from 'lucide-react'

interface MoveOperation {
  source: string
  destination: string
  type: 'file' | 'directory'
}

interface OrganizePlan {
  directories: string[]
  moves: MoveOperation[]
}

export class FileOrganizerAgent extends BaseAgent {
  constructor(platform: PlatformAPI) { super(platform) }

  config: AgentConfig = {
    id: 'file-organizer',
    name: 'James',
    description: '根据建议重新分类与整理文件',
    icon: FolderCog,
    color: '#F8A16F',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 James，文件整理专家。你专注于根据建议重新分类与整理文件。

## 你的团队
- **Oliver** - 智能调度助手（团队领导），负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **William** - 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** - 文档摘要专家，读取文档内容，总结项目核心信息
- **James** (你) - 文件整理专家，根据建议重新分类与整理文件

## 重要规则
- 你是文件整理专家，永远不要称自己为"文件分析专家"、"代码审查专家"或"领导 Agent"。
- 你的职责是整理文件，不是分析文件夹结构或审查代码。
- 回复时始终明确你的身份是"文件整理专家 James"。

## 工作流程
1. 分析当前文件夹的文件结构
2. 根据文件类型、用途、项目模块等维度提出分类方案
3. 生成具体的整理计划（JSON 格式）
4. 用户确认后执行文件移动操作

## 输出格式
当用户要求整理文件时，你必须输出一个 JSON 计划，格式如下：

\`\`\`json
{
  "directories": ["src", "docs", "assets", "config"],
  "moves": [
    {"source": "readme.md", "destination": "docs/readme.md", "type": "file"},
    {"source": "logo.png", "destination": "assets/logo.png", "type": "file"}
  ]
}
\`\`\`

- directories: 需要创建的子目录列表（相对于根目录）
- moves: 文件移动操作列表
  - source: 当前文件路径（相对于根目录）
  - destination: 目标路径（相对于根目录）
  - type: "file" 或 "directory"

在 JSON 之前，用简短的中文说明你的整理方案。
语言: 中文。`,
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    if (!ctx.folder.files || ctx.folder.files.length === 0) {
      return '请先选择文件夹并等待扫描完成。'
    }

    // 检查用户是否在确认执行（连续对话场景）
    const isConfirmation = this.isConfirmation(ctx.userMessage, ctx.history)
    
    if (isConfirmation) {
      // 从历史消息中提取之前的计划并执行
      return await this.executePlan(ctx)
    }

    // 生成整理计划
    const fileInfo = this.collectFileInfo(ctx.folder.files)
    const allFiles = this.flattenFiles(ctx.folder.files)
    
    const prompt = `请分析以下文件信息，生成文件整理计划。

## 当前文件夹
路径: ${ctx.folder.path}
总文件数: ${fileInfo.totalFiles}
总大小: ${this.formatSize(fileInfo.totalSize)}

## 文件列表（相对路径）
${allFiles.map(f => `- ${f.relativePath} (${this.formatSize(f.size)})`).join('\n')}

## 文件分布
${fileInfo.byType.map(t => `- ${t.ext || '无扩展名'}: ${t.count} 个文件 (${this.formatSize(t.size)})`).join('\n')}

## 用户要求
${ctx.userMessage}

${ctx.leaderContext ? `## 调度助手分析\n${ctx.leaderContext}\n` : ''}

请生成整理计划（JSON 格式），包括：
1. 需要创建的子目录
2. 需要移动的文件清单

注意：source 和 destination 都是相对于根目录的路径。`

    const messages = [
      { role: 'system' as const, content: this.config.systemPrompt },
      { role: 'user' as const, content: prompt },
    ]

    try {
      const { callLLMStream } = await import('../utils/llm')
      if (onToken) {
        return await callLLMStream(
          { provider: this.config.provider, model: this.config.model || '', messages },
          onToken,
        )
      } else {
        const { callLLM } = await import('../utils/llm')
        return await callLLM({
          provider: this.config.provider,
          model: this.config.model || '',
          messages,
        })
      }
    } catch (err: any) {
      return `整理计划生成失败: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private isConfirmation(userMessage: string, history?: { role: 'user' | 'agent'; content: string }[]): boolean {
    const confirmWords = ['同意', '确认', '执行', '开始', '好的', '可以', '没问题', 'ok', 'yes', 'do it', 'go ahead']
    const msg = userMessage.toLowerCase().trim()
    
    // 检查当前消息是否是确认
    const isConfirm = confirmWords.some(w => msg.includes(w))
    if (!isConfirm) return false
    
    // 检查历史中是否有 James 的整理计划
    if (!history || history.length === 0) {
      console.log('[James] No history available')
      return false
    }
    
    // 查找所有 agent 消息
    const agentMsgs = history.filter(m => m.role === 'agent')
    console.log(`[James] Found ${agentMsgs.length} agent messages in history`)
    
    // 简单的匹配 - 检查是否包含关键字（支持中英文引号）
    const recentJamesMsg = [...history].reverse().find(m => {
      if (m.role !== 'agent') return false
      const content = m.content.toLowerCase()
      // 支持 ASCII 引号和中文引号
      return (content.includes('directories') || content.includes('\u201cdirectories\u201d')) && 
             (content.includes('moves') || content.includes('\u201cmoves\u201d'))
    })
    
    if (recentJamesMsg) {
      console.log('[James] Found plan in history, executing...')
    } else {
      console.log('[James] No plan found in history')
      // 打印最近的几条消息用于调试
      const lastFew = [...history].reverse().slice(0, 3).map(m => ({
        role: m.role,
        preview: m.content.substring(0, 100)
      }))
      console.log('[James] Last few messages:', lastFew)
    }
    
    return !!recentJamesMsg
  }

  private async executePlan(ctx: { folder: FolderProject; history?: { role: 'user' | 'agent'; content: string }[] }): Promise<string> {
    if (!ctx.history) return '无法找到之前的整理计划。'

    // 从历史中找到 James 的计划 - 更宽松的匹配
    const planMsg = [...ctx.history].reverse().find(m => 
      m.role === 'agent' && 
      (m.content.includes('"directories"') || m.content.includes('directories')) &&
      (m.content.includes('"moves"') || m.content.includes('moves'))
    )
    
    if (!planMsg) {
      console.log('[James] No plan found in executePlan')
      console.log('[James] History:', ctx.history.map(m => ({ role: m.role, preview: m.content.substring(0, 50) })))
      return '未找到之前的整理计划，请重新提出整理请求。'
    }

    // 提取 JSON - 支持多种格式（ASCII引号、中文引号）
    let jsonStr = ''
    const jsonMatch = planMsg.content.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    } else {
      // 尝试直接找 JSON 对象
      const objMatch = planMsg.content.match(/\{[\s\S]*?directories[\s\S]*?moves[\s\S]*?\}/)
      if (objMatch) {
        jsonStr = objMatch[0]
      }
    }
    
    if (!jsonStr) {
      console.log('[James] Could not extract JSON from plan')
      console.log('[James] Plan content preview:', planMsg.content.substring(0, 200))
      return '计划格式不正确，无法执行。'
    }

    // 将中文引号替换为 ASCII 引号，确保 JSON 解析成功
    jsonStr = jsonStr
      .replace(/\u201c/g, '"')  // " → "
      .replace(/\u201d/g, '"')  // " → "
      .replace(/\u2018/g, "'")  // ' → '
      .replace(/\u2019/g, "'")  // ' → '

    let plan: OrganizePlan
    try {
      plan = JSON.parse(jsonStr)
      console.log('[James] Parsed plan:', plan)
    } catch (e) {
      console.log('[James] JSON parse error:', e)
      console.log('[James] JSON string:', jsonStr.substring(0, 300))
      return '计划 JSON 解析失败。'
    }

    const rootPath = ctx.folder.path.replace(/[/\\]$/, '')
    const results: string[] = []
    let successCount = 0
    let failCount = 0

    // 第一步：创建目录
    for (const dir of plan.directories) {
      const dirPath = `${rootPath}/${dir.replace(/^[/\\]+/, '')}`
      const result = await this.platform.fs.createDirectory(dirPath)
      if (result.success) {
        results.push(`✅ 创建目录: ${dir}`)
        successCount++
      } else {
        results.push(`⚠️ 目录已存在或创建失败: ${dir}`)
      }
    }

    // 第二步：移动文件
    for (const move of plan.moves) {
      const srcPath = `${rootPath}/${move.source.replace(/^[/\\]+/, '')}`
      const destPath = `${rootPath}/${move.destination.replace(/^[/\\]+/, '')}`
      
      const result = move.type === 'directory'
        ? await this.platform.fs.moveDirectory(srcPath, destPath)
        : await this.platform.fs.moveFile(srcPath, destPath)
      
      if (result.success) {
        results.push(`✅ ${move.type === 'directory' ? '移动目录' : '移动文件'}: ${move.source} → ${move.destination}`)
        successCount++
      } else {
        results.push(`❌ 移动失败: ${move.source} - ${result.error || '未知错误'}`)
        failCount++
      }
    }

    return `## 整理执行结果\n\n**成功: ${successCount} 项 | 失败: ${failCount} 项**\n\n${results.join('\n')}`
  }

  private collectFileInfo(files: FileEntry[]) {
    const typeMap = new Map<string, { count: number; size: number }>()
    let totalFiles = 0
    let totalSize = 0

    const traverse = (entries: FileEntry[]) => {
      for (const f of entries) {
        if (f.isDirectory) {
          if (f.children) traverse(f.children)
        } else {
          totalFiles++
          totalSize += f.size
          const ext = f.ext || '无扩展名'
          const current = typeMap.get(ext) || { count: 0, size: 0 }
          typeMap.set(ext, { count: current.count + 1, size: current.size + f.size })
        }
      }
    }

    traverse(files)

    return {
      totalFiles,
      totalSize,
      byType: [...typeMap.entries()]
        .map(([ext, data]) => ({ ext, ...data }))
        .sort((a, b) => b.count - a.count),
    }
  }

  private flattenFiles(files: FileEntry[]): FileEntry[] {
    const result: FileEntry[] = []
    const traverse = (entries: FileEntry[]) => {
      for (const f of entries) {
        if (f.isDirectory) {
          if (f.children) traverse(f.children)
        } else {
          result.push(f)
        }
      }
    }
    traverse(files)
    return result
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}
