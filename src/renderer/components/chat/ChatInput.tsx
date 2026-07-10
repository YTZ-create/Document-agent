import React, { useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useFolderStore } from '../../stores/folderStore'
import { useFormFillStore } from '../../stores/formFillStore'
import { agentRegistry } from '../../agents/registry'
import { FormFillerAgent, type FormDocument, type FormField } from '../../agents/formFiller'
import { getKnowledgeBase } from '../../knowledge'
import { getMemoryStore } from '../../memory'
import { getDependencyAnalyzer } from '../../codebase'
import { detectHandoff } from '../../utils/handoff'
import { START_REPLIES, END_REPLIES, randomPick } from '../../utils/replies'
import type { FileEntry } from '../../api/platformAPI'

const DOC_EXTS = new Set(['.md', '.txt', '.html', '.htm', '.rtf', '.csv', '.json', '.yaml', '.yml', '.xml', '.docx', '.pdf', '.doc', '.xls', '.xlsx'])

// 中文数字转阿拉伯数字，用于模糊匹配文件名
function normalizeChineseNumbers(text: string): string {
  const map: Record<string, string> = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
    '零': '0', '两': '2',
  }
  return text.replace(/[零一二三四五六七八九十两]/g, (c) => map[c] || c)
}

function findTargetDocFile(files: FileEntry[], userMsg: string): FileEntry | null {
  const flatFiles: FileEntry[] = []
  const flatten = (entries: FileEntry[]) => {
    for (const f of entries) {
      if (f.isDirectory && f.children) {
        flatten(f.children)
      } else {
        flatFiles.push(f)
      }
    }
  }
  flatten(files)

  const docFiles = flatFiles.filter((f) => DOC_EXTS.has(f.ext.toLowerCase()))

  if (docFiles.length === 0) return null

  // 如果只有一个文档，直接返回（无需用户选择）
  if (docFiles.length === 1) {
    console.log('[findTargetDocFile] Only one document found, auto-selecting:', docFiles[0].name)
    return docFiles[0]
  }

  const lowerMsg = userMsg.toLowerCase()
  const normalizedMsg = normalizeChineseNumbers(lowerMsg)

  // 先尝试精确匹配（原始文件名）
  for (const f of docFiles) {
    if (lowerMsg.includes(f.name.toLowerCase())) return f
  }

  // 优先匹配"附件一"、"附件1"、"附件2"等具体表达（必须在模糊匹配之前）
  const attachmentMatch = lowerMsg.match(/附件[一二三四五六七八九十\d]+/)
  if (attachmentMatch) {
    // 提取用户指定的附件编号（如"附件2"→"2"）
    const userSpecifiedNum = attachmentMatch[0].replace(/附件/, '')
    const normalizedUserNum = normalizeChineseNumbers(userSpecifiedNum)
    console.log('[findTargetDocFile] User specified attachment:', attachmentMatch[0], '→ normalized num:', normalizedUserNum)

    for (const f of docFiles) {
      const normalizedName = normalizeChineseNumbers(f.name.toLowerCase())
      // 精确匹配附件编号：文件名中必须包含"附件X"或"附件x"的模式
      const fileAttachmentMatch = normalizedName.match(/附件[一二三四五六七八九十\d]+/i)
      if (fileAttachmentMatch) {
        const fileNum = fileAttachmentMatch[0].replace(/附件/i, '')
        const normalizedFileNum = normalizeChineseNumbers(fileNum)
        console.log('[findTargetDocFile] File:', f.name, '→ file num:', normalizedFileNum)
        if (normalizedUserNum === normalizedFileNum) {
          console.log('[findTargetDocFile] Match found:', f.name)
          return f
        }
      }
    }
    // 用户明确说了"附件X"但没匹配到，返回null让用户选择
    console.log('[findTargetDocFile] User mentioned specific attachment but no match found:', attachmentMatch[0])
    return null
  }

  // 模糊匹配（中文数字转阿拉伯数字后）
  for (const f of docFiles) {
    const normalizedName = normalizeChineseNumbers(f.name.toLowerCase())
    const strippedMsg = normalizedMsg.replace(/帮我填写|填写|文档|文件|附件/g, '').trim()
    if (strippedMsg.length === 0) continue // 去掉关键词后为空，跳过模糊匹配
    if (normalizedMsg.includes(normalizedName) || normalizedName.includes(strippedMsg)) return f
  }

  // 最后尝试：用户消息中的关键词匹配文件名的一部分
  const keywords = lowerMsg.replace(/帮我填写|填写|文档|文件|这个|那个|附件[一二三四五六七八九十\d]+/g, '').trim().split(/\s+/)
  for (const kw of keywords) {
    if (kw.length < 1) continue
    const normalizedKw = normalizeChineseNumbers(kw)
    for (const f of docFiles) {
      const normalizedName = normalizeChineseNumbers(f.name.toLowerCase())
      if (normalizedName.includes(normalizedKw) || normalizedKw.includes(normalizedName)) return f
    }
  }

  // 模糊表达处理：如果用户说"附件"、"这个表"、"帮我完成"等
  const vaguePatterns = [/附件/, /这个表/, /这个文档/, /帮我完成/, /帮我填/, /完成.*表/, /填.*表/]
  const isVague = vaguePatterns.some(p => p.test(lowerMsg))

  if (isVague) {
    // 模糊表达始终让用户选择，避免误选
    console.log('[findTargetDocFile] Vague expression, returning null for user selection. Docs:', docFiles.map(f => f.name))
    return null
  }

  // 没有匹配到任何文件，返回null让用户选择
  console.log('[findTargetDocFile] No match found, returning null for user selection. Available docs:', docFiles.map(f => f.name))
  return null
}



export const ChatInput: React.FC = () => {
  const inputValue = useChatStore((s) => s.inputValue)
  const setInputValue = useChatStore((s) => s.setInputValue)
  const addMessage = useChatStore((s) => s.addMessage)
  const updateLastMessage = useChatStore((s) => s.updateLastMessage)
  const setIsStreaming = useChatStore((s) => s.setIsStreaming)
  const activeAgentId = useChatStore((s) => s.activeAgentId)
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const activeFolderId = useFolderStore((s) => s.activeFolderId)
  const activeFolder = useFolderStore((s) => s.folders.find((f) => f.id === activeFolderId))
  const activeDocument = useFormFillStore((s) => s.activeDocument)
  const isFormFillingSession = useFormFillStore((s) => s.isFormFillingSession)
  const setIsFormFillingSession = useFormFillStore((s) => s.setIsFormFillingSession)
  const endSession = useFormFillStore((s) => s.endSession)
  const formFillPhase = useFormFillStore((s) => s.formFillPhase)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // 组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text) return
    if (isStreaming) return
    if (!activeFolder) {
      addMessage({ role: 'system', content: '请先在侧边栏选择一个文件夹' })
      return
    }

    addMessage({ role: 'user', content: text })
    setInputValue('')
    setIsStreaming(true)

    const controller = new AbortController()
    useChatStore.getState().setAbortController(controller)

    // 构建对话历史 - 使用 store 的最新状态
    const currentMessages = useChatStore.getState().messages
    const history: { role: 'user' | 'agent'; content: string; agentName?: string }[] = currentMessages
      .filter((m) => m.role === 'user' || m.role === 'agent')
      .map((m) => ({ role: m.role as 'user' | 'agent', content: m.content, agentName: m.agentName }))

    try {
      // 表单填写会话锁：会话进行中时，所有消息直接路由到 Ethan，不走 Oliver
      // 检查是否有正在进行的表单填写任务（activeDocument 存在且未退出）
      const hasActiveFormSession = useFormFillStore.getState().activeDocument !== null
      
      if ((isFormFillingSession || hasActiveFormSession) && (text === '退出' || text === 'exit' || text === '取消' || text.includes('不填了') || text.includes('退出填写'))) {
        endSession()
        addMessage({ role: 'system', content: '已退出表单填写会话' })
        setIsStreaming(false)
        useChatStore.getState().setAbortController(null)
        return
      }

      // 如果有活跃的表单会话，直接路由到 Ethan
      const effectiveAgentId = (isFormFillingSession || hasActiveFormSession) ? 'form-filler' : (activeAgentId || 'leader')
      const agentId = effectiveAgentId
      const agent = agentRegistry.get(agentId)
      const config = agentRegistry.getConfig(agentId)

      // Ethan - 表单填写 Agent 特殊流程
      if (agentId === 'form-filler' && agent instanceof FormFillerAgent) {
        // 如果已有活跃文档，说明是填写过程中的对话，不需要重新提取字段
        if (activeDocument) {
          // 如果处于勾选阶段，提示用户先完成勾选
          if (formFillPhase === 'select') {
            addMessage({ role: 'agent', content: '请先在下方勾选需要填写的字段，然后点击"开始填写"按钮。', agentName: 'Ethan', agentColor: '#F472B6' })
            setIsStreaming(false)
            useChatStore.getState().setAbortController(null)
            return
          }

          const currentField = activeDocument.fields[activeDocument.currentFieldIndex]
          if (!currentField) {
            addMessage({ role: 'agent', content: '所有字段已填写完毕！说"完成"来生成填写好的文档。', agentName: 'Ethan', agentColor: '#F472B6' })
            setIsStreaming(false)
            useChatStore.getState().setAbortController(null)
            return
          }

          // 用 LLM 理解用户自然语言意图
          const intent = await classifyFormIntent(text, currentField, activeDocument.fields.length, activeDocument.currentFieldIndex)

          switch (intent.action) {
            case 'fill_field': {
              const value = intent.value || text
              useFormFillStore.getState().updateField(currentField.id, value, 'user')
              addMessage({ role: 'agent', content: `已记录 **${currentField.label}** 的内容。`, agentName: 'Ethan', agentColor: '#F472B6' })

              const nextIdx = Math.min(activeDocument.currentFieldIndex + 1, activeDocument.fields.length - 1)
              if (nextIdx !== activeDocument.currentFieldIndex) {
                useFormFillStore.getState().setCurrentFieldIndex(nextIdx)
                const nextField = activeDocument.fields[nextIdx]
                const timer = setTimeout(() => {
                  addMessage({
                    role: 'agent',
                    content: `第 ${nextIdx + 1} / ${activeDocument.fields.length} 项：**${nextField.label}**\n\n${nextField.placeholder ? `> ${nextField.placeholder}` : ''}`,
                    agentName: 'Ethan',
                    agentColor: '#F472B6',
                  })
                  setIsStreaming(false)
                  timersRef.current.delete(timer)
                }, 300)
                timersRef.current.add(timer)
              } else {
                addMessage({ role: 'agent', content: '所有字段已填写完毕！说"完成"来生成填写好的文档。', agentName: 'Ethan', agentColor: '#F472B6' })
                setIsStreaming(false)
              }
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'ai_generate': {
              await handleAIGenerate(activeDocument, activeFolder, agent, currentField, addMessage, updateLastMessage, setIsStreaming)
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'next_field': {
              handleFieldNav(activeDocument, 1, addMessage)
              setIsStreaming(false)
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'prev_field': {
              handleFieldNav(activeDocument, -1, addMessage)
              setIsStreaming(false)
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'skip_field': {
              addMessage({ role: 'agent', content: `已跳过 **${currentField.label}**，不填写此项。`, agentName: 'Ethan', agentColor: '#F472B6' })
              const nextIdx = Math.min(activeDocument.currentFieldIndex + 1, activeDocument.fields.length - 1)
              if (nextIdx !== activeDocument.currentFieldIndex) {
                useFormFillStore.getState().setCurrentFieldIndex(nextIdx)
                const nextField = activeDocument.fields[nextIdx]
                const timer = setTimeout(() => {
                  addMessage({
                    role: 'agent',
                    content: `第 ${nextIdx + 1} / ${activeDocument.fields.length} 项：**${nextField.label}**\n\n${nextField.placeholder ? `> ${nextField.placeholder}` : ''}`,
                    agentName: 'Ethan',
                    agentColor: '#F472B6',
                  })
                  setIsStreaming(false)
                  timersRef.current.delete(timer)
                }, 300)
                timersRef.current.add(timer)
              } else {
                addMessage({ role: 'agent', content: '所有字段已处理完毕！说"完成"来生成填写好的文档。', agentName: 'Ethan', agentColor: '#F472B6' })
                setIsStreaming(false)
              }
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'complete': {
              // 不再通过对话框命令触发完成，统一由 FormFillView 的"完成"按钮处理
              addMessage({ role: 'agent', content: '请点击下方工具栏的"完成"按钮来生成填写好的文档。', agentName: 'Ethan', agentColor: '#F472B6' })
              setIsStreaming(false)
              useChatStore.getState().setAbortController(null)
              return
            }

            case 'exit': {
              endSession()
              addMessage({ role: 'system', content: '已退出表单填写会话' })
              setIsStreaming(false)
              useChatStore.getState().setAbortController(null)
              return
            }

            default: {
              // other: 当作填写字段处理
              useFormFillStore.getState().updateField(currentField.id, text, 'user')
              addMessage({ role: 'agent', content: `已记录 **${currentField.label}** 的内容。`, agentName: 'Ethan', agentColor: '#F472B6' })

              const nextIdx = Math.min(activeDocument.currentFieldIndex + 1, activeDocument.fields.length - 1)
              if (nextIdx !== activeDocument.currentFieldIndex) {
                useFormFillStore.getState().setCurrentFieldIndex(nextIdx)
                const nextField = activeDocument.fields[nextIdx]
                const timer = setTimeout(() => {
                  addMessage({
                    role: 'agent',
                    content: `第 ${nextIdx + 1} / ${activeDocument.fields.length} 项：**${nextField.label}**\n\n${nextField.placeholder ? `> ${nextField.placeholder}` : ''}`,
                    agentName: 'Ethan',
                    agentColor: '#F472B6',
                  })
                  setIsStreaming(false)
                  timersRef.current.delete(timer)
                }, 300)
                timersRef.current.add(timer)
              } else {
                addMessage({ role: 'agent', content: '所有字段已填写完毕！说"完成"来生成填写好的文档。', agentName: 'Ethan', agentColor: '#F472B6' })
                setIsStreaming(false)
              }
              useChatStore.getState().setAbortController(null)
              return
            }
          }
        }

        // 没有活跃文档，需要提取字段 —— 立即锁定会话，防止后续消息被 Oliver 路由走
        setIsFormFillingSession(true)
        useChatStore.getState().setActiveAgent('form-filler')

        // 递归获取所有文档文件（包括子文件夹），过滤掉文件名含模板变量的无效文件
        const allDocFiles: FileEntry[] = []
        const collectDocFiles = (files: FileEntry[]) => {
          for (const f of files) {
            if (f.isDirectory && f.children) {
              collectDocFiles(f.children)
            } else if (DOC_EXTS.has(f.ext.toLowerCase()) && !/\$\d+/.test(f.name)) {
              allDocFiles.push(f)
            }
          }
        }
        collectDocFiles(activeFolder.files || [])
        if (allDocFiles.length === 0) {
          addMessage({ role: 'system', content: '未找到可填写的文档文件（支持 .md, .txt, .html, .docx, .pdf 等格式）' })
          setIsFormFillingSession(false)
          setIsStreaming(false)
          useChatStore.getState().setAbortController(null)
          return
        }

        // 尝试根据用户消息找到目标文件（使用递归收集的 allDocFiles）
        const targetFile = findTargetDocFile(allDocFiles, text)

        if (targetFile) {
          // 用户说了具体文件名，直接提取字段
          console.log('[FormFiller Direct] Found target file:', targetFile.name, 'path:', targetFile.path)
          console.log('[FormFiller Direct] File details:', { name: targetFile.name, ext: targetFile.ext, path: targetFile.path, size: targetFile.size })
          addMessage({ role: 'agent', content: `正在分析文档 **${targetFile.name}**，提取待填项...`, agentName: config?.name, agentColor: config?.color })
          useChatStore.getState().addAgentConversation({
            agentName: config?.name || 'Ethan',
            agentColor: config?.color || '#F472B6',
            content: randomPick(START_REPLIES),
            isLeader: false,
          })

          try {
            console.log('[FormFiller Direct] Starting extractFieldsFromDoc for:', targetFile.path)
            const { fields, content, rawContent } = await agent.extractFieldsFromDoc(targetFile.path)
            console.log('[FormFiller Direct] Extracted fields:', fields.length, 'content length:', content.length)
            console.log('[FormFiller Direct] Content preview:', content.substring(0, 200))
            const doc: FormDocument = {
              filePath: targetFile.path,
              fileName: targetFile.name,
              originalContent: content,
              rawContent,
              fields,
              currentFieldIndex: 0,
              status: 'filling',
            }
            useFormFillStore.getState().setActiveDocument(doc)
            useFormFillStore.getState().setFormFillPhase('select')

            const lastMsg = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
            if (lastMsg && lastMsg.role === 'agent') {
              updateLastMessage(`已从 **${targetFile.name}** 中提取到 **${fields.length}** 个待填项。\n\n请在下方勾选需要填写的字段，然后点击"开始填写"。`)
            }

            useChatStore.getState().addAgentConversation({
              agentName: config?.name || 'Ethan',
              agentColor: config?.color || '#F472B6',
              content: randomPick(END_REPLIES),
              isLeader: false,
            })
          } catch (err: any) {
            console.error('[FormFiller Direct] extractFieldsFromDoc failed:', err)
            updateLastMessage(`❌ 分析失败: ${err.message}\n\n文件: ${targetFile.name}\n路径: ${targetFile.path}\n\n请检查文件是否为有效的文档格式（.docx, .pdf, .txt 等）。`)
            setIsFormFillingSession(false)
          } finally {
            useChatStore.getState().setAbortController(null)
            setIsStreaming(false)
          }
        } else {
          // 用户没说具体文件名，显示文件选择界面
          addMessage({ role: 'agent', content: `找到 ${allDocFiles.length} 个文档，请在下方选择要填写的文档。`, agentName: config?.name, agentColor: config?.color })
          useChatStore.getState().addAgentConversation({
            agentName: config?.name || 'Ethan',
            agentColor: config?.color || '#F472B6',
            content: randomPick(END_REPLIES),
            isLeader: false,
          })

          useFormFillStore.getState().setAvailableFiles(allDocFiles)
          useFormFillStore.getState().setFormFillPhase('file-select')
          useChatStore.getState().setAbortController(null)
          setIsStreaming(false)
        }
        return
      }

      // Phase 2: 知识库检索
      let knowledgeContext: string | undefined
      try {
        const kb = getKnowledgeBase()
        if (activeFolder.files) {
          if (!kb.isBuiltFor(activeFolder.path)) {
            await kb.buildFromFileTree(activeFolder.files, activeFolder.path)
          }
          knowledgeContext = kb.getRelevantContext(text)
        }
      } catch {
        // KB 未初始化或构建失败，不影响主流程
      }

      // Phase 5: 代码库依赖分析（仅对 code-reviewer 和 file-analyzer）
      let codebaseContext: string | undefined
      const analysisAgentIds = ['code-reviewer', 'file-analyzer']
      if (analysisAgentIds.includes(agentId)) {
        try {
          const analyzer = getDependencyAnalyzer()
          if (activeFolder.files && !analyzer.isBuiltFor(activeFolder.path)) {
            await analyzer.buildFromFileTree(activeFolder.files, activeFolder.path)
          }
          codebaseContext = analyzer.getContextForLLM()
        } catch {
          // 依赖分析失败不影响主流程
        }
      }

      if (agent) {
        // 先添加一个空的 agent 消息占位
        addMessage({ role: 'agent', content: '', agentName: config?.name, agentColor: config?.color })
        // 流式输出
        const result = await agent.execute(
          { folder: activeFolder, userMessage: text, history, signal: controller.signal, knowledgeContext, codebaseContext },
          (token: string) => {
            if (controller.signal.aborted) return
            const state = useChatStore.getState()
            const lastMsg = state.messages[state.messages.length - 1]
            if (lastMsg && lastMsg.role === 'agent') {
              updateLastMessage(lastMsg.content + token)
            }
          }
        )

        if (controller.signal.aborted) return

        // 如果 LeaderAgent 返回了调度指令，创建子 Agent 的新消息气泡
        if (agentId === 'leader') {
          try {
            const dispatch = JSON.parse(result)
            if (dispatch.__dispatch) {
              const subAgent = agentRegistry.get(dispatch.targetAgentId)
              const subConfig = agentRegistry.getConfig(dispatch.targetAgentId)
              if (subAgent) {
                // 创建子 Agent 的消息气泡
                addMessage({ role: 'agent', content: '', agentName: dispatch.agentName, agentColor: dispatch.agentColor })
                // 推送 Leader 调度通知到对话面板
                useChatStore.getState().addAgentConversation({
                  agentName: 'Oliver',
                  agentColor: '#FFD440',
                  content: ` 已将任务分配给 **${dispatch.agentName}**`,
                  isLeader: true,
                })

                // 关键修复：如果调度到 form-filler，走特殊流程（文件选择 → 提取字段 → 勾选界面）
                if (dispatch.targetAgentId === 'form-filler' && subAgent instanceof FormFillerAgent) {
                  setIsFormFillingSession(true)
                  useChatStore.getState().setActiveAgent('form-filler')

                  // 递归获取所有文档文件（包括子文件夹），过滤掉文件名含模板变量的无效文件
                  const allDocFiles: FileEntry[] = []
                  const collectDocFiles = (files: FileEntry[]) => {
                    for (const f of files) {
                      if (f.isDirectory && f.children) {
                        collectDocFiles(f.children)
                      } else if (DOC_EXTS.has(f.ext.toLowerCase()) && !/\$\d+/.test(f.name)) {
                        allDocFiles.push(f)
                      }
                    }
                  }
                  // 关键修复：使用 activeFolder.files 递归收集，确保子文件夹中的文档也能找到
                  const rootFiles = activeFolder.files || []
                  console.log('[Dispatch] Root files count:', rootFiles.length)
                  collectDocFiles(rootFiles)
                  console.log('[Dispatch] Collected doc files count:', allDocFiles.length)
                  console.log('[Dispatch] Collected doc files:', allDocFiles.map(f => ({ name: f.name, path: f.path })))

                  if (allDocFiles.length === 0) {
                    const lastMsg = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
                    if (lastMsg && lastMsg.role === 'agent') {
                      updateLastMessage('未找到可填写的文档文件（支持 .md, .txt, .html, .docx, .pdf 等格式）')
                    }
                    setIsFormFillingSession(false)
                    setIsStreaming(false)
                    useChatStore.getState().setAbortController(null)
                    return
                  }

                  // 尝试根据用户消息找到目标文件（使用递归收集的 allDocFiles）
                  const targetFile = findTargetDocFile(allDocFiles, text)

                  if (targetFile) {
                    // 用户说了具体文件名，直接提取字段
                    console.log('[Dispatch] Found target file:', targetFile.name, 'path:', targetFile.path)
                    console.log('[Dispatch] File details:', { name: targetFile.name, ext: targetFile.ext, path: targetFile.path, size: targetFile.size })
                    const lastMsg = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
                    if (lastMsg && lastMsg.role === 'agent') {
                      updateLastMessage(`正在分析文档 **${targetFile.name}**，提取待填项...`)
                    }

                    try {
                      console.log('[Dispatch] Starting extractFieldsFromDoc for:', targetFile.path)
                      const { fields, content, rawContent } = await subAgent.extractFieldsFromDoc(targetFile.path)
                      console.log('[Dispatch] Extracted fields:', fields.length, 'content length:', content.length)
                      console.log('[Dispatch] Content preview:', content.substring(0, 200))
                      const doc: FormDocument = {
                        filePath: targetFile.path,
                        fileName: targetFile.name,
                        originalContent: content,
                        rawContent,
                        fields,
                        currentFieldIndex: 0,
                        status: 'filling',
                      }
                      useFormFillStore.getState().setActiveDocument(doc)
                      // 进入字段勾选阶段
                      useFormFillStore.getState().setFormFillPhase('select')

                      // 更新最后一条消息
                      const lastMsg2 = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
                      if (lastMsg2 && lastMsg2.role === 'agent') {
                        updateLastMessage(`已从 **${targetFile.name}** 中提取到 **${fields.length}** 个待填项。\n\n请在下方勾选需要填写的字段，然后点击"开始填写"。`)
                      }

                      useChatStore.getState().addAgentConversation({
                        agentName: dispatch.agentName,
                        agentColor: dispatch.agentColor,
                        content: randomPick(END_REPLIES),
                        isLeader: false,
                      })
                    } catch (err: any) {
                      console.error('[Dispatch] extractFieldsFromDoc failed:', err)
                      const lastMsg2 = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
                      if (lastMsg2 && lastMsg2.role === 'agent') {
                        updateLastMessage(`❌ 分析失败: ${err.message}\n\n文件: ${targetFile.name}\n路径: ${targetFile.path}\n\n请检查文件是否为有效的文档格式（.docx, .pdf, .txt 等）。`)
                      }
                      setIsFormFillingSession(false)
                    } finally {
                      useChatStore.getState().setAbortController(null)
                      setIsStreaming(false)
                    }
                  } else {
                    // 用户没说具体文件名，显示文件选择界面
                    const lastMsg = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
                    if (lastMsg && lastMsg.role === 'agent') {
                      updateLastMessage(`找到 ${allDocFiles.length} 个文档，请在下方选择要填写的文档。`)
                    }

                    // 保存文件列表到 store，进入文件选择阶段
                    useFormFillStore.getState().setAvailableFiles(allDocFiles)
                    useFormFillStore.getState().setFormFillPhase('file-select')

                    useChatStore.getState().addAgentConversation({
                      agentName: dispatch.agentName,
                      agentColor: dispatch.agentColor,
                      content: randomPick(END_REPLIES),
                      isLeader: false,
                    })
                  }
                  return
                }

                const subResult = await subAgent.execute(
                  { folder: activeFolder, userMessage: text, leaderContext: dispatch.leaderContext, history, signal: controller.signal, knowledgeContext, codebaseContext },
                  (token: string) => {
                    if (controller.signal.aborted) return
                    const state = useChatStore.getState()
                    const lastMsg = state.messages[state.messages.length - 1]
                    if (lastMsg && lastMsg.role === 'agent') {
                      updateLastMessage(lastMsg.content + token)
                    }
                  }
                )
                if (controller.signal.aborted) return
                // 子 Agent 完成通知（随机回复）
                useChatStore.getState().addAgentConversation({
                  agentName: dispatch.agentName,
                  agentColor: dispatch.agentColor,
                  content: randomPick(END_REPLIES),
                  isLeader: false,
                })

                // 检测子 Agent 的手交指令（仅限一次，防止循环）
                const handoff = detectHandoff(subResult)
                if (handoff) {
                  const nextAgent = agentRegistry.get(handoff.targetAgentId)
                  const nextConfig = agentRegistry.getConfig(handoff.targetAgentId)
                  if (nextAgent && nextConfig) {
                    // 推送手交通知
                    useChatStore.getState().addAgentConversation({
                      agentName: dispatch.agentName,
                      agentColor: dispatch.agentColor,
                      content: ` 任务已转交给 **${nextConfig.name}**`,
                      isLeader: true,
                    })
                    // 创建被手交 Agent 的消息气泡
                    addMessage({ role: 'agent', content: '', agentName: nextConfig.name, agentColor: nextConfig.color })
                    await nextAgent.execute(
                      { folder: activeFolder, userMessage: text, history, signal: controller.signal, knowledgeContext, codebaseContext },
                      (token: string) => {
                        if (controller.signal.aborted) return
                        const state = useChatStore.getState()
                        const lastMsg = state.messages[state.messages.length - 1]
                        if (lastMsg && lastMsg.role === 'agent') {
                          updateLastMessage(lastMsg.content + token)
                        }
                      }
                    )
                    if (!controller.signal.aborted) {
                      useChatStore.getState().addAgentConversation({
                        agentName: nextConfig.name,
                        agentColor: nextConfig.color,
                        content: randomPick(END_REPLIES),
                        isLeader: false,
                      })
                      // 不再继续检测手交，防止循环
                    }
                  }
                }
              }
            }
          } catch (e) {
            // 不是调度指令，忽略
            if (e instanceof SyntaxError) {
              console.warn('[ChatInput] Failed to parse dispatch result:', result)
            }
          }
        } else {
          // 直接调用子 Agent 时，也推送开始和结束回复到对话面板
          useChatStore.getState().addAgentConversation({
            agentName: config?.name || 'Agent',
            agentColor: config?.color || '#FFD440',
            content: randomPick(START_REPLIES),
            isLeader: false,
          })
          useChatStore.getState().addAgentConversation({
            agentName: config?.name || 'Agent',
            agentColor: config?.color || '#FFD440',
            content: randomPick(END_REPLIES),
            isLeader: false,
          })

          // 检测手交指令（仅限一次，防止循环）
          const handoff = detectHandoff(result)
          if (handoff) {
            const nextAgent = agentRegistry.get(handoff.targetAgentId)
            const nextConfig = agentRegistry.getConfig(handoff.targetAgentId)
            if (nextAgent && nextConfig) {
              useChatStore.getState().addAgentConversation({
                agentName: config?.name || 'Agent',
                agentColor: config?.color || '#FFD440',
                content: ` 任务已转交给 **${nextConfig.name}**`,
                isLeader: true,
              })
              addMessage({ role: 'agent', content: '', agentName: nextConfig.name, agentColor: nextConfig.color })
              await nextAgent.execute(
                { folder: activeFolder, userMessage: text, history, signal: controller.signal, knowledgeContext, codebaseContext },
                (token: string) => {
                  if (controller.signal.aborted) return
                  const state = useChatStore.getState()
                  const lastMsg = state.messages[state.messages.length - 1]
                  if (lastMsg && lastMsg.role === 'agent') {
                    updateLastMessage(lastMsg.content + token)
                  }
                }
              )
              if (!controller.signal.aborted) {
                useChatStore.getState().addAgentConversation({
                  agentName: nextConfig.name,
                  agentColor: nextConfig.color,
                  content: randomPick(END_REPLIES),
                  isLeader: false,
                })
              }
            }
          }
        }
      } else {
        addMessage({ role: 'system', content: '未找到对应的 Agent' })
      }

      // Phase 3: 自动记忆 — 分析完成后存储结果摘要
      try {
        const memoryStore = getMemoryStore()
        const currentMessages = useChatStore.getState().messages
        const lastAgentMsg = [...currentMessages].reverse().find((m) => m.role === 'agent')
        if (lastAgentMsg && lastAgentMsg.content && lastAgentMsg.content.length > 100) {
          const summary = lastAgentMsg.content.substring(0, 2000)
          memoryStore.upsert({
            category: 'analysis-result',
            key: `proj:${activeFolder.path.replace(/[/\\:]/g, '-')}:analysis-${Date.now()}`,
            content: summary,
            tags: [activeFolder.path.split(/[/\\]/).pop() || 'project', config?.name || 'agent'],
            projectPath: activeFolder.path,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 天 TTL
          })
        }
      } catch {
        // 自动记忆失败不影响主流程
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        addMessage({ role: 'system', content: '已停止生成' })
      } else {
        addMessage({ role: 'system', content: `错误: ${err.message}` })
      }
    } finally {
      // 只有当前 controller 是活跃的才重置，避免干扰并发请求
      const currentController = useChatStore.getState().abortController
      if (currentController === controller) {
        useChatStore.getState().setAbortController(null)
        setIsStreaming(false)
      }
    }
  }

  const allAgents = agentRegistry.getAll()
  const quickActions = allAgents.map((a) => ({
    id: a.id,
    label: a.name,
    icon: React.createElement(a.icon, { size: 12 }),
  }))

  return (
    <div className="border-t-2 border-brutal-black bg-white p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {quickActions.map((a) => (
          <button key={a.id}
            onClick={() => { useChatStore.getState().setActiveAgent(a.id) }}
            className={`tab-brutal text-xs flex items-center gap-1.5 ${activeAgentId === a.id ? 'active' : ''}`}>
            {a.icon}{a.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-black/70 font-mono">{activeFolder ? 'Enter 发送' : '请选择文件夹'}</span>
      </div>
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="text" value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="用自然语言描述你的需求..."
          className="input-brutal flex-1 text-sm" disabled={!activeFolder || isStreaming} />
        {isStreaming ? (
          <button onClick={stopGeneration}
            className="btn-brutal bg-brutal-pink text-white p-2.5 flex-shrink-0 hover:bg-brutal-pink/80"
            title="停止生成">
            <Square size={16} fill="white" />
          </button>
        ) : (
          <button onClick={handleSend} disabled={!inputValue.trim() || !activeFolder}
            className="btn-brutal bg-brutal-yellow p-2.5 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
