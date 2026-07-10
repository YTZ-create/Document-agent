import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { PlatformAPI } from '../api/platformAPI'
import { FlaskConical } from 'lucide-react'

export class PlaceholderAgent extends BaseAgent {
  constructor(platform: PlatformAPI) {
    super(platform)
  }

  config: AgentConfig = {
    id: 'placeholder',
    name: 'Ethan',
    description: '正在开发中，敬请期待',
    icon: FlaskConical,
    color: '#6EE7B7',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 Ethan，一个正在开发中的 Agent。

当用户与你对话时，请友好地告知用户你正在开发中，敬请期待。

## 回复示例
- "你好！我是 Ethan，目前还在开发中，敬请期待我的新功能！"
- "抱歉，我还在开发中，暂时无法提供帮助。请稍后再来找我吧！"

语言: 中文。`,
  }

  async execute(
    ctx: AgentContext,
    onToken?: (token: string) => void
  ): Promise<string> {
    const reply = '你好！我是 Ethan，目前还在开发中，敬请期待我的新功能！🚀'
    if (onToken) {
      for (const char of reply) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 10))
      }
    }
    return reply
  }
}