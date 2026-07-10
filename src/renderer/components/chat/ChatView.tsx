import React, { useRef, useEffect } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useFormFillStore } from '../../stores/formFillStore'
import { agentRegistry } from '../../agents/registry'
import { MessageBubble } from './MessageBubble'
import { ChatInput } from './ChatInput'
import { FieldSelector } from './FieldSelector'
import { FileSelector } from './FileSelector'
import { FormFillView } from './FormFillView'

export const ChatView: React.FC = () => {
  const messages = useChatStore((s) => s.messages)
  const activeAgentId = useChatStore((s) => s.activeAgentId)
  const activeDocument = useFormFillStore((s) => s.activeDocument)
  const formFillPhase = useFormFillStore((s) => s.formFillPhase)
  const scrollRef = useRef<HTMLDivElement>(null)

  const showFieldSelector = activeAgentId === 'form-filler' && activeDocument && formFillPhase === 'select'
  const showFileSelector = activeAgentId === 'form-filler' && formFillPhase === 'file-select'
  const showFormFillView = activeAgentId === 'form-filler' && activeDocument && formFillPhase === 'fill'

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-brutal-cream">
        {messages.length === 0 ? <WelcomeScreen /> : (
          <div className="py-2">
            {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            {showFileSelector && <FileSelector />}
            {showFieldSelector && <FieldSelector />}
            {showFormFillView && <FormFillView />}
          </div>
        )}
      </div>
      <ChatInput />
    </div>
  )
}

const WelcomeScreen: React.FC = () => {
  const agents = agentRegistry.getAll()
  const leader = agents.find((a) => a.id === 'leader')
  const otherAgents = agents.filter((a) => a.id !== 'leader')

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12">
      <p className="text-black/80 text-sm mb-6 text-center">选择文件夹，使用 AI Agent 分析内容<br />或输入关键字搜索文件</p>

      {leader && (
        <button
          onClick={() => {
            useChatStore.getState().setActiveAgent(leader.id)
            useChatStore.getState().setInputValue('')
          }}
          className="card-brutal p-5 text-left cursor-pointer w-full max-w-md mb-4 bg-brutal-yellow"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-none border-2 border-brutal-black flex items-center justify-center flex-shrink-0" style={{ backgroundColor: leader.color }}>
              {React.createElement(leader.icon, { size: 24, color: '#141111' })}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-base">{leader.name}</span>
                <span className="text-[9px] text-black/70 font-mono tracking-wider">推荐</span>
              </div>
              <p className="text-xs text-black/70 leading-relaxed">{leader.description}</p>
            </div>
          </div>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3 w-full max-w-md">
        {otherAgents.map((agent) => (
          <button key={agent.id}
            onClick={() => {
              useChatStore.getState().setActiveAgent(agent.id)
              useChatStore.getState().setInputValue('')
            }}
            className="card-brutal p-4 text-left cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-none border-2 border-brutal-black flex items-center justify-center flex-shrink-0" style={{ backgroundColor: agent.color }}>
                {React.createElement(agent.icon, { size: 20, color: '#141111' })}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm block">{agent.name}</span>
                <p className="text-[11px] text-black/70 leading-snug mt-0.5">{agent.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
