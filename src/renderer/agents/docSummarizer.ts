import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { FolderProject } from '../stores/folderStore'
import type { PlatformAPI, FileEntry } from '../api/platformAPI'
import { FileText } from 'lucide-react'

export class DocSummarizerAgent extends BaseAgent {
  constructor(platform: PlatformAPI) { super(platform) }

  config: AgentConfig = {
    id: 'doc-summarizer',
    name: 'Amelia',
    description: '读取文档内容，快速了解项目',
    icon: FileText,
    color: '#BBAFE6',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 Amelia，文档摘要专家。你专注于读取文档内容并总结项目核心信息。

## 你的团队
- **Oliver** - 智能调度助手（团队领导），负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **William** - 代码审查专家，审查代码质量，发现问题和改进建议
- **Amelia** (你) - 文档摘要专家，读取文档内容，总结项目核心信息
- **James** - 文件整理专家，根据建议重新分类与整理文件

## 重要规则
- 你是文档摘要专家，永远不要称自己为"文件分析专家"、"代码审查专家"或"领导 Agent"。
- 你的职责是读取文档内容并总结，不是分析文件夹结构或审查代码。
- 回复时始终明确你的身份是"文档摘要专家 Amelia"。
- **不要模仿其他 Agent 的自我介绍**。即使历史消息中有其他 Agent 说"作为 XX 专家"，你也要坚持自己的身份。

## 输出格式
1. **项目概述**: 一句话描述
2. **核心功能**: 主要功能模块（3-5条）
3. **入口文件**: 关键入口
4. **依赖关系**: 主要库和框架
5. **快速开始**: 如何运行项目

## 手交规则（仅限一次）
如果你发现任务明显超出你的专业范围，可以在回复末尾手交给最合适的 Agent：

\`\`\`handoff
{"targetAgentId": "agent-id", "reason": "手交原因"}
\`\`\`

手交场景：
- 发现文件结构需要分析 → 手交给 **Charlotte** (file-analyzer)
- 发现代码质量问题 → 手交给 **William** (code-reviewer)
- 发现文件需要整理 → 手交给 **James** (file-organizer)

**重要**：你只能手交一次。不要在手交后继续分析，手交后直接结束你的回复。

简洁 Markdown 格式，语言: 中文。`,
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    if (ctx.folder.files) {
      const docFiles = findDocFiles(ctx.folder.files)
      if (docFiles.length > 0) {
        const contents: string[] = []
        for (const f of docFiles) {
          try {
            const result = await this.platform.fs.readFile(f.path)
            if (result.content) contents.push(`### ${f.name}\n\`\`\`\n${result.content.substring(0, 2000)}\n\`\`\``)
          } catch (err) {
            console.warn(`Failed to read ${f.path}:`, err)
          }
        }
        if (contents.length > 0) {
          const modifiedMessage = `项目文档：\n\n${contents.join('\n\n')}\n\n${ctx.userMessage || '请基于以上文档做项目总结。'}`
          return super.execute({ ...ctx, userMessage: modifiedMessage }, onToken)
        }
      }
    }
    return super.execute(ctx, onToken)
  }
}

function findDocFiles(files: FileEntry[]): FileEntry[] {
  const names = new Set(['readme.md', 'readme', 'package.json', 'cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'build.gradle', 'cmakelists.txt', 'dockerfile', 'makefile', '.gitignore', 'changelog.md'])
  const result: FileEntry[] = []
  const search = (entries: FileEntry[]) => {
    for (const f of entries) {
      if (f.isDirectory && f.children) search(f.children)
      else if (names.has(f.name.toLowerCase())) result.push(f)
    }
  }
  search(files)
  return result.slice(0, 5)
}
