import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../stores/chatStore'
import { formatChatTime } from '../../utils/formatters'
import { Bot, User, Info, Sparkles, FolderSearch, Code2, FileText, FolderCog, Brain, FlaskConical, FileOutput } from 'lucide-react'
import { agentRegistry } from '../../agents/registry'
import { AgentCard } from './AgentCard'
import { cleanHandoffContent } from '../../utils/handoff'
import type { AgentConfig } from '../../agents/base'

const AGENT_ICONS: Record<string, React.ComponentType<{ size?: number | string; color?: string }>> = {
  'leader': Sparkles,
  'file-analyzer': FolderSearch,
  'code-reviewer': Code2,
  'doc-summarizer': FileText,
  'file-organizer': FolderCog,
  'memory': Brain,
  'form-filler': FileOutput,
}

export const MessageBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const [showCard, setShowCard] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null)

  if (message.role === 'system') {
    return <div className="msg-system flex items-center justify-center gap-2"><Info size={12} />{message.content}</div>
  }

  const isAgent = message.role === 'agent'
  const agentColor = message.agentColor || '#FFD440'
  const agentIcon = message.agentName
    ? (AGENT_ICONS[agentRegistry.getAll().find(a => a.name === message.agentName)?.id || ''] ?? Bot)
    : Bot

  const handleAvatarClick = () => {
    if (isAgent && message.agentName) {
      console.log('[AgentCard] Clicked avatar for:', message.agentName)
      const agentConfig = agentRegistry.getAll().find(a => a.name === message.agentName)
      console.log('[AgentCard] Found agent config:', agentConfig)
      if (agentConfig) {
        setSelectedAgent(agentConfig)
        setShowCard(true)
      }
    }
  }

  return (
    <>
      <div className={`flex gap-3 px-4 py-2 ${isAgent ? '' : 'flex-row-reverse'}`}>
        <div 
          className={`w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1 ${isAgent ? 'cursor-pointer hover:scale-110 transition-transform duration-75' : ''}`}
          style={{ backgroundColor: isAgent ? agentColor : '#141111' }}
          onClick={handleAvatarClick}
          title={isAgent ? `查看 ${message.agentName} 的名片` : ''}
        >
          {isAgent ? React.createElement(agentIcon, { size: 16, color: '#141111' }) : <User size={16} color="#FFFAEF" />}
        </div>
        <div className={`max-w-[75%] min-w-0 ${isAgent ? '' : 'items-end'}`}>
          <div className={`flex items-center gap-2 mb-1 ${isAgent ? '' : 'flex-row-reverse'}`}>
            <span className="font-bold text-xs">{isAgent ? message.agentName || 'Agent' : '你'}</span>
            <span className="text-[10px] text-black/70 font-mono">{formatChatTime(message.timestamp)}</span>
          </div>
          <div className={isAgent ? 'msg-agent bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm' : 'msg-user'}>
            {isAgent ? (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]}>{typeof message.content === 'string' ? cleanHandoffContent(message.content) : String(message.content || '')}</ReactMarkdown>{message.content === '' && <span className="inline-block w-2 h-4 bg-brutal-black animate-pulse ml-0.5 align-middle" />}</div>
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{String(message.content)}</div>
            )}
          </div>
        </div>
      </div>
      
      {showCard && selectedAgent && (
        <AgentCard agent={selectedAgent} onClose={() => setShowCard(false)} />
      )}
    </>
  )
}
