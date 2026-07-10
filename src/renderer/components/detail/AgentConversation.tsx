import React, { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore, type AgentConversationMessage } from '../../stores/chatStore'
import { formatChatTime } from '../../utils/formatters'
import { cleanHandoffContent } from '../../utils/handoff'
import { Sparkles, FolderSearch, Code2, FileText, FolderCog, FileOutput } from 'lucide-react'

const AGENT_ICONS: Record<string, React.ComponentType<{ size?: number | string; color?: string }>> = {
  'Oliver': Sparkles,
  'Charlotte': FolderSearch,
  'William': Code2,
  'Amelia': FileText,
  'James': FolderCog,
  'Ethan': FileOutput,
}

const AgentBubble: React.FC<{ message: AgentConversationMessage }> = ({ message }) => {
  const Icon = AGENT_ICONS[message.agentName] || Sparkles
  const isLeader = message.isLeader

  return (
    <div className={`flex gap-2 px-3 py-2 ${isLeader ? '' : 'flex-row-reverse'}`}>
      <div
        className="w-7 h-7 rounded-none flex-shrink-0 flex items-center justify-center border-2 border-brutal-black"
        style={{ backgroundColor: message.agentColor }}
      >
        <Icon size={14} color="#141111" />
      </div>
      <div className={`max-w-[85%] min-w-0 ${isLeader ? '' : 'items-end'}`}>
        <div className={`flex items-center gap-2 mb-1 ${isLeader ? '' : 'flex-row-reverse'}`}>
          <span className="font-bold text-[11px]">{message.agentName}</span>
          <span className="text-[9px] text-black/70 font-mono">{formatChatTime(message.timestamp)}</span>
        </div>
        <div className={`${isLeader ? 'bg-brutal-cream border-2 border-brutal-black p-2.5 shadow-brutal-sm' : 'bg-white border-2 border-brutal-black border-r-4 p-2.5 shadow-brutal-sm'}`}>
          <div className="prose prose-sm max-w-none text-[12px] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanHandoffContent(message.content)}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AgentConversation: React.FC = () => {
  const conversation = useChatStore((s) => s.agentConversation)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [conversation])

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-brutal-cream">
        {conversation.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8">
            <div className="w-10 h-10 bg-brutal-yellow border-2 border-brutal-black rounded-none flex items-center justify-center mb-3">
              <Sparkles size={20} color="#141111" />
            </div>
            <p className="text-black/70 text-[11px] text-center leading-relaxed">
              发送消息后，<br />Agent 之间的对话将在这里显示
            </p>
          </div>
        ) : (
          <div className="py-2">
            {conversation.map((msg) => (
              <AgentBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
