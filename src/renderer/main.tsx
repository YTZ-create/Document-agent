import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { initNeutralino, createNeutralinoPlatform } from './api/neutralino'
import { createAgentRegistry, agentRegistry } from './agents/registry'
import { initKnowledgeBase } from './knowledge'
import { initMemoryStore } from './memory'
import { createDependencyAnalyzer } from './codebase'
import { useSidebarStore } from './stores/sidebarStore'

// 先渲染 UI，不等待 Neutralino
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// 异步初始化 Neutralino（窗口控制等原生 API 需要）
initNeutralino().then(async () => {
  const platform = createNeutralinoPlatform()
  const memoryStore = await initMemoryStore(platform)
  createAgentRegistry(platform, memoryStore)
  useSidebarStore.getState().setAgents(agentRegistry.getAll())
  initKnowledgeBase(platform)
  createDependencyAnalyzer(platform)
  console.log('[AI Agent] Platform, Agent Registry, Memory, KB & Codebase analyzer initialized')
}).catch((err) => {
  console.warn('[AI Agent] Neutralino init failed:', err)
})
