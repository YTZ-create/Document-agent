import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { FolderProject } from '../stores/folderStore'
import type { PlatformAPI, FileEntry } from '../api/platformAPI'
import { Code2 } from 'lucide-react'

export class CodeReviewerAgent extends BaseAgent {
  constructor(platform: PlatformAPI) { super(platform) }

  config: AgentConfig = {
    id: 'code-reviewer',
    name: 'William',
    description: '审查代码质量，发现问题和改进建议',
    icon: Code2,
    color: '#27CCF3',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 William，代码审查专家。你专注于审查代码质量、发现代码问题和提供改进建议。

## 你的团队
- **Oliver** - 智能调度助手（团队领导），负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **William** (你) - 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** - 文档摘要专家，读取文档内容，总结项目核心信息
- **James** - 文件整理专家，根据建议重新分类与整理文件

## 重要规则
- 你是代码审查专家，永远不要称自己为"文件分析专家"、"文档分析专家"或"领导 Agent"。
- 你的职责是审查代码质量，不是分析文件夹结构。
- 回复时始终明确你的身份是"代码审查专家 William"。
- **不要模仿其他 Agent 的自我介绍**。即使历史消息中有其他 Agent 说"作为 XX 专家"，你也要坚持自己的身份。

## 审查维度
1. **代码结构**: 架构合理性、模块划分
2. **可读性**: 命名规范、注释质量
3. **安全性**: 潜在安全漏洞
4. **性能**: 可优化点
5. **最佳实践**: 是否符行业标准

## 手交规则（仅限一次）
如果你发现任务明显超出你的专业范围，可以在回复末尾手交给最合适的 Agent：

\`\`\`handoff
{"targetAgentId": "agent-id", "reason": "手交原因"}
\`\`\`

手交场景：
- 发现文件结构混乱 → 手交给 **Charlotte** (file-analyzer)
- 发现文档缺失需要总结 → 手交给 **Amelia** (doc-summarizer)
- 发现代码需要重构整理 → 手交给 **James** (file-organizer)

**重要**：你只能手交一次。不要在手交后继续分析，手交后直接结束你的回复。

给出友好有建设性的审查报告，有具体代码建议时给出改进前后对比。语言: 中文。`,
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    if (ctx.folder.files) {
      const codeFiles = findCodeFiles(ctx.folder.files, 5)
      if (codeFiles.length > 0) {
        const snippets: string[] = []
        for (const f of codeFiles) {
          try {
            const result = await this.platform.fs.readFile(f.path)
            if (result.content) snippets.push(`### ${f.relativePath}\n\`\`\`\n${result.content.substring(0, 1500)}\n\`\`\``)
          } catch (err) {
            console.warn(`Failed to read ${f.path}:`, err)
          }
        }
        if (snippets.length > 0) {
          const modifiedMessage = `以下为代码片段：\n\n${snippets.join('\n\n')}\n\n用户说明: ${ctx.userMessage}`
          return super.execute({ ...ctx, userMessage: modifiedMessage }, onToken)
        }
      }
    }
    return super.execute(ctx, onToken)
  }
}

function findCodeFiles(files: FileEntry[], max: number): FileEntry[] {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h'])
  const result: FileEntry[] = []
  const search = (entries: FileEntry[]) => {
    for (const f of entries) {
      if (result.length >= max) return
      if (f.isDirectory && f.children) search(f.children)
      else {
        const ext = f.ext.startsWith('.') ? f.ext : `.${f.ext}`
        if (exts.has(ext)) result.push(f)
      }
    }
  }
  search(files)
  return result
}
