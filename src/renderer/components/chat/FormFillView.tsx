import React, { useState, useRef, useEffect, useCallback } from 'react'
import { User, FileInput, ChevronLeft, ChevronRight, Wand2, Check, Settings, ChevronDown, X } from 'lucide-react'
import { useFormFillStore } from '../../stores/formFillStore'
import { useFolderStore } from '../../stores/folderStore'
import { agentRegistry } from '../../agents/registry'
import { FormFillerAgent, type FormField } from '../../agents/formFiller'
import { getPlatform } from '../../api/neutralino'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FillMethod } from '../../utils/docxHandler'

interface ChatBubble {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
}

export const FormFillView: React.FC = () => {
  const {
    activeDocument, setIsProcessing, isProcessing,
    updateField, setStatus, setCurrentFieldIndex,
    selectedFieldIds, endSession,
    fillMethod, setFillMethod,
    updateFieldDeletePlaceholder,
  } = useFormFillStore()
  const currentFieldIndex = activeDocument?.currentFieldIndex || 0
  const activeFolder = useFolderStore((s) => s.folders.find((f) => f.id === s.activeFolderId))
  const [fillOrder, setFillOrder] = useState<string[]>([])
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [inputValue, setInputValue] = useState('')
  const [showFillMethodSelector, setShowFillMethodSelector] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [methodProgress, setMethodProgress] = useState<Array<{method: string, status: 'trying' | 'success' | 'failed'}>>([])
  const [pendingPlaceholderConfirm, setPendingPlaceholderConfirm] = useState<{fieldId: string; anchorText: string} | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // 组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [bubbles])

  // 点击外部关闭下拉
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.fill-method-dropdown')) {
      setShowDropdown(false)
    }
  }, [])

  useEffect(() => {
    if (!showDropdown) return
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown, handleClickOutside])

  // 初始化：使用选中的字段 ID（只在 selectedFieldIds 变化时触发，避免 activeDocument 变化导致无限循环）
  const initRef = React.useRef(false)
  const prevSelectedFieldIdsRef = React.useRef<string[]>([])
  
  useEffect(() => {
    if (activeDocument) {
      // 检测 selectedFieldIds 是否真正变化（不是首次加载）
      const hasChanged = JSON.stringify(prevSelectedFieldIdsRef.current) !== JSON.stringify(selectedFieldIds)
      
      if (!initRef.current || hasChanged) {
        initRef.current = true
        prevSelectedFieldIdsRef.current = selectedFieldIds
        
        // 优先使用选中的字段 ID，如果没有则使用所有字段
        const ids = selectedFieldIds.length > 0 ? selectedFieldIds : activeDocument.fields.map(f => f.id)
        setFillOrder(ids)

        // 延迟设置 currentFieldIndex，避免在渲染期间更新 activeDocument 导致 React 循环
        const timer1 = setTimeout(() => {
          setCurrentFieldIndex(0)
          timersRef.current.delete(timer1)
        }, 0)
        timersRef.current.add(timer1)

        addBubble('agent', `已选择 **${ids.length}** 个字段，我们逐个来填写。

你可以：
- **直接输入** — 填写当前字段
- 说 **"AI 生成"** — 让我帮你生成内容
- 说 **"跳过"** — 不填这个，下一个
- 说 **"完成"** — 生成填写好的文档`)

        // 展示第一个字段
        const firstField = activeDocument.fields.find(f => f.id === ids[0])
        if (firstField) {
          const timer2 = setTimeout(() => {
            addBubble('agent', `第 1 / ${ids.length} 项：**${firstField.label}**

${firstField.placeholder ? `> ${firstField.placeholder}` : ''}`)
            timersRef.current.delete(timer2)
          }, 300)
          timersRef.current.add(timer2)
        }
      }
    }
  }, [selectedFieldIds])

  const addBubble = useCallback((role: 'user' | 'agent', content: string) => {
    setBubbles((b) => [...b, {
      id: `bubble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    }])
  }, [])

  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text || !activeDocument || isProcessing) return
    setInputValue('')

    const currentFillIdx = currentFieldIndex
    const currentFieldId = fillOrder[currentFillIdx]
    const currentField = activeDocument.fields.find(f => f.id === currentFieldId)
    if (!currentField) return

    // 命令词列表（用于冲突检测）
    const commandWords = ['跳过', '不填', '不填这个', '这个不要', '没有', '不需要', '完成', '好了', '生成文档', '上一个', '回去', '刚才那个', '下一个', '继续']
    const isCommandWord = commandWords.includes(text)

    // AI 生成 - 使用更精确的模式匹配，避免误拦截
    const aiGeneratePatterns = [
      /\b(ai|AI)\s*(生成|填写|帮我|帮忙)/i,
      /帮我(生成|填写|写|创建)/,
      /AI\s*生成/,
      /智能(生成|填写)/,
      /^(生成|帮我填|帮我写|AI生成)$/
    ]
    const isAIGenerate = !isCommandWord && aiGeneratePatterns.some(pattern => pattern.test(text))
    
    if (isAIGenerate) {
      addBubble('user', text)
      await handleAIGenerate(currentField)
      return
    }

    // 跳过（完全匹配优先）
    const skipWords = ['跳过', '不填', '不填这个', '这个不要', '没有', '不需要']
    if (skipWords.includes(text)) {
      addBubble('user', text)
      addBubble('agent', `已跳过 **${currentField.label}**，不填写此项。`)
      goToNext()
      return
    }

    // 完成（完全匹配优先）
    if (text === '完成' || text === '好了' || text === '生成文档') {
      addBubble('user', text)
      // 先询问用户选择填写方式
      addBubble('agent', `所有字段已填写完毕！请选择文档生成方式：`)
      // 显示填写方式选择器（作为对话气泡的一部分）
      setShowFillMethodSelector(true)
      return
    }

    // 上一个（完全匹配优先）
    if (text === '上一个' || text === '回去' || text === '刚才那个') {
      addBubble('user', text)
      if (currentFillIdx > 0) {
        setCurrentFieldIndex(currentFillIdx - 1)
        const prevId = fillOrder[currentFillIdx - 1]
        const prevField = activeDocument.fields.find(f => f.id === prevId)
        if (prevField) {
          addBubble('agent', `回到第 ${currentFillIdx} / ${fillOrder.length} 项：**${prevField.label}**

${prevField.placeholder ? `> ${prevField.placeholder}` : ''}
${prevField.value ? `当前值：${prevField.value}` : ''}`)
        }
      } else {
        addBubble('agent', '已经是第一项了。')
      }
      return
    }

    // 下一个（完全匹配优先）
    if (text === '下一个' || text === '继续') {
      addBubble('user', text)
      goToNext()
      return
    }

    // 冲突检测：如果用户输入恰好是命令词，确认意图
    if (isCommandWord) {
      addBubble('user', text)
      addBubble('agent', `你输入了 "**${text}**"。你是想把它作为 **${currentField.label}** 的填写内容，还是想执行命令？

- 直接再发一次 "**${text}**" → 作为填写内容
- 输入其他命令（如"跳过""下一个"）→ 执行命令`)
      return
    }

    // 占位文字删除确认：如果字段有 anchorText，先弹出确认框，阻止用户输入
    if (currentField.anchorText && pendingPlaceholderConfirm?.fieldId !== currentField.id) {
      addBubble('user', text)
      addBubble('agent', `检测到该字段对应文档中的占位文字：

> ${currentField.anchorText}

**请先选择处理方式**，选择后才能继续输入内容：`)
      setPendingPlaceholderConfirm({ fieldId: currentField.id, anchorText: currentField.anchorText })
      return
    }

    // 默认：填写当前字段
    addBubble('user', text)
    updateField(currentField.id, text, 'user')
    addBubble('agent', `已记录 **${currentField.label}** 的内容。`)
    goToNext()
  }

  const goToNext = () => {
    if (!activeDocument) return
    const nextIdx = currentFieldIndex + 1
    if (nextIdx >= fillOrder.length) {
      addBubble('agent', '所有字段已处理完毕！说"完成"来生成填写好的文档。')
      return
    }
    setCurrentFieldIndex(nextIdx)
    const nextId = fillOrder[nextIdx]
    const nextField = activeDocument.fields.find(f => f.id === nextId)
    if (nextField) {
      // 清除过期的占位文字确认状态
      setPendingPlaceholderConfirm(null)
      const timer = setTimeout(() => {
        addBubble('agent', `第 ${nextIdx + 1} / ${fillOrder.length} 项：**${nextField.label}**

${nextField.placeholder ? `> ${nextField.placeholder}` : ''}
${nextField.value ? `当前值：${nextField.value}` : ''}`)
        timersRef.current.delete(timer)
      }, 300)
      timersRef.current.add(timer)
    }
  }

  const handleAIGenerate = async (field: FormField) => {
    if (!activeDocument) return
    setIsProcessing(true)
    addBubble('agent', `正在为 **${field.label}** 生成内容...`)

    try {
      const agent = agentRegistry.get('form-filler') as FormFillerAgent | undefined
      if (!agent) throw new Error('FormFillerAgent not found')

      const context = buildContext()
      const value = await agent.generateAIFill(field, context)
      updateField(field.id, value, 'ai')

      setBubbles((b) => {
        const copy = [...b]
        const lastIdx = copy.length - 1
        if (lastIdx >= 0) {
          copy[lastIdx] = {
            ...copy[lastIdx],
            content: `AI 生成的 **${field.label}** 内容：

> ${value}

满意的话说"下一个"继续，不满意可以直接输入你自己的内容覆盖。`,
          }
        }
        return copy
      })
    } catch (err: any) {
      addBubble('agent', `生成失败：${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const buildContext = (): string => {
    if (!activeDocument || !activeFolder) return ''
    const lines: string[] = []
    lines.push(`文件夹：${activeFolder.path}`)
    lines.push(`文档：${activeDocument.fileName}`)
    lines.push('')
    lines.push('已填写的字段：')
    for (const f of activeDocument.fields) {
      if (f.value) lines.push(`- ${f.label}：${f.value}`)
    }
    lines.push('')
    lines.push('文档原始内容摘要：')
    lines.push(activeDocument.originalContent.substring(0, 2000))
    return lines.join('\n')
  }

  const handleFillComplete = async () => {
    if (!activeDocument || !activeFolder) return
    setIsProcessing(true)
    setStatus('completed')
    setMethodProgress([])
    addBubble('agent', '正在将所有内容填入文档...')

    try {
      const agent = agentRegistry.get('form-filler') as FormFillerAgent | undefined
      if (!agent) throw new Error('FormFillerAgent not found')

      const filledContent = await agent.fillDocument(
        activeDocument.originalContent,
        activeDocument.fields,
        activeDocument.filePath,
        activeDocument.rawContent,
        fillMethod,
        (method, status) => {
          setMethodProgress(prev => {
            const existing = prev.findIndex(p => p.method === method)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = { method, status }
              return updated
            }
            return [...prev, { method, status }]
          })
        }
      )

      const newFileName = activeDocument.fileName.replace(/\.([^.]+)$/, '_filled.$1')
      const newFilePath = activeDocument.filePath.replace(/\.([^.]+)$/, '_filled.$1')

      console.log(`[FormFillView] Saving filled document:`, { newFileName, newFilePath, filledContentLength: filledContent.length })

      const platform = getPlatform()
      if (!platform) {
        console.error(`[FormFillView] Platform not available!`)
        throw new Error('Platform not available')
      }

      const isBinaryFormat = activeDocument.filePath.toLowerCase().endsWith('.docx') || 
                             activeDocument.filePath.toLowerCase().endsWith('.pdf')

      if (isBinaryFormat) {
        // 将 base64 转换为 ArrayBuffer
        const binaryString = atob(filledContent)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        // 创建精确大小的 ArrayBuffer
        const arrayBuffer = new ArrayBuffer(bytes.length)
        const view = new Uint8Array(arrayBuffer)
        view.set(bytes)

        console.log(`[FormFillView] Writing binary file:`)
        console.log(`  path: ${newFilePath}`)
        console.log(`  bytes.length: ${bytes.length}`)
        console.log(`  arrayBuffer.byteLength: ${arrayBuffer.byteLength}`)
        console.log(`  filledContent (base64) length: ${filledContent.length}`)
        console.log(`  filledContent first 100 chars: ${filledContent.substring(0, 100)}`)

        const writeResult = await platform.fs.writeBinaryFile(newFilePath, arrayBuffer)
        console.log(`[FormFillView] writeBinaryFile result:`, writeResult)

        if (!writeResult.success) {
          console.error(`[FormFillView] Write failed: ${writeResult.error}`)
          throw new Error(`写入文件失败: ${writeResult.error}`)
        }

        // 读回验证
        const { content: readBack, error: readError } = await platform.fs.readBinaryFile(newFilePath)
        if (readError) {
          throw new Error(`文件写入验证失败：无法读取已写入的文件 — ${readError}`)
        }
        if (!readBack) {
          throw new Error('文件写入验证失败：读回的文件内容为空')
        }

        const readBytes = new Uint8Array(readBack)
        console.log(`[FormFillView] Read-back: written=${bytes.length}, read=${readBytes.length}`)

        // 文件大小必须一致
        if (bytes.length !== readBytes.length) {
          console.error(`[FormFillView] Size mismatch: written=${bytes.length}, read=${readBytes.length}`)
          throw new Error(`文件写入验证失败：写入大小 ${bytes.length} 字节，但读回 ${readBytes.length} 字节`)
        }

        // 逐字节比较前 1000 字节
        let matchCount = 0
        let firstMismatch = -1
        const compareLen = Math.min(bytes.length, readBytes.length, 1000)
        for (let i = 0; i < compareLen; i++) {
          if (bytes[i] === readBytes[i]) matchCount++
          else if (firstMismatch === -1) firstMismatch = i
        }
        console.log(`[FormFillView] Byte comparison: ${matchCount}/${compareLen} match, first mismatch at: ${firstMismatch}`)

        if (matchCount !== compareLen) {
          console.error(`[FormFillView] Content mismatch at byte ${firstMismatch}: written=0x${bytes[firstMismatch].toString(16)}, read=0x${readBytes[firstMismatch].toString(16)}`)
          throw new Error(`文件写入验证失败：第 ${firstMismatch} 字节处数据不匹配（写入 0x${bytes[firstMismatch].toString(16)}，读回 0x${readBytes[firstMismatch].toString(16)}）`)
        }

        // 同时比较原始文件（确认内容确实被修改了）
        const { content: origContent } = await platform.fs.readBinaryFile(activeDocument.filePath)
        if (origContent) {
          const origBytes = new Uint8Array(origContent)
          console.log(`[FormFillView] Original file size: ${origBytes.length}, Filled file size: ${readBytes.length}`)

          let diffCount = 0
          const minLen = Math.min(origBytes.length, readBytes.length, 5000)
          for (let i = 0; i < minLen; i++) {
            if (origBytes[i] !== readBytes[i]) diffCount++
          }
          console.log(`[FormFillView] Differences from original in first ${minLen} bytes: ${diffCount}`)
          if (diffCount === 0 && origBytes.length === readBytes.length) {
            console.warn('[FormFillView] Warning: Filled file is identical to original — fill may not have worked')
          }
        }
      } else {
        const writeResult = await platform.fs.writeFile(newFilePath, filledContent)
        console.log(`[FormFillView] writeFile result:`, writeResult)
        if (!writeResult.success) {
          throw new Error(`写入文件失败: ${writeResult.error}`)
        }
      }

      const filledCount = activeDocument.fields.filter(f => f.value).length
      setBubbles((b) => {
        const copy = [...b]
        copy[copy.length - 1] = {
          ...copy[copy.length - 1],
          content: `✅ 文档填写完成！

**新文件已保存：**
${newFilePath}

**原始文件：** ${activeDocument.filePath}

共填写 ${filledCount} 个字段。

⚠️ 请打开 **${newFileName}** 文件查看填写结果（不是原始文件）`,
        }
        return copy
      })

      // 填写完成后结束会话，隐藏组件，并传入填写后文件路径
      setTimeout(() => {
        endSession(newFilePath)
      }, 1000)
    } catch (err: any) {
      addBubble('agent', `填写失败：${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  if (!activeDocument) return null

  const filledCount = activeDocument.fields.filter(f => f.value).length
  const progressPercentage = fillOrder.length > 0 ? (filledCount / fillOrder.length) * 100 : 0

  return (
    <div className="flex flex-col h-full bg-brutal-cream">
      {/* Header */}
      <div className="border-b-2 border-brutal-black bg-white px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 border-2 border-brutal-black flex items-center justify-center" style={{ backgroundColor: '#F472B6' }}>
              <FileInput size={16} color="#141111" style={{ transform: 'scaleX(-1)' }} />
            </div>
            <div>
              <div className="font-bold text-sm">Ethan · 信息采集助手</div>
              <div className="text-[10px] text-black/70 font-mono">{activeDocument.fileName}</div>
            </div>
          </div>
          <div className="text-[10px] font-mono text-black/70">
            {filledCount} / {fillOrder.length} 已填
          </div>
        </div>
        <div className="h-2 bg-brutal-cream border-2 border-brutal-black">
          <div className="h-full bg-brutal-yellow transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {/* 填写阶段 - 对话气泡 */}
        {bubbles.map((bubble) => (
          <div key={bubble.id} className={`flex gap-3 px-4 py-2 ${bubble.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1`}
              style={{ backgroundColor: bubble.role === 'agent' ? '#F472B6' : '#141111' }}
            >
              {bubble.role === 'agent' ? <FileInput size={16} color="#141111" /> : <User size={16} color="#FFFAEF" />}
            </div>
            <div className={`max-w-[75%] min-w-0 ${bubble.role === 'user' ? 'items-end' : ''}`}>
              <div className={`flex items-center gap-2 mb-1 ${bubble.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <span className="font-bold text-xs">{bubble.role === 'agent' ? 'Ethan' : '你'}</span>
                <span className="text-[10px] text-black/70 font-mono">
                  {new Date(bubble.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className={bubble.role === 'agent'
                ? 'bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm'
                : 'msg-user'}>
                <div className="prose prose-sm max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex gap-3 px-4 py-2">
            <div className="w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1" style={{ backgroundColor: '#F472B6' }}>
              <FileInput size={16} color="#141111" className="animate-pulse" />
            </div>
            <div className="bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm">
              <span className="inline-block w-2 h-4 bg-brutal-black animate-pulse ml-0.5 align-middle" />
            </div>
          </div>
        )}

        {/* 占位文字删除确认按钮 */}
        {pendingPlaceholderConfirm && (() => {
          const currentFieldId = fillOrder[currentFieldIndex]
          const currentField = activeDocument.fields.find(f => f.id === currentFieldId)
          if (!currentField || pendingPlaceholderConfirm.fieldId !== currentField.id) return null
          
          return (
            <div className="flex gap-3 px-4 py-2">
              <div className="w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1" style={{ backgroundColor: '#F472B6' }}>
                <FileInput size={16} color="#141111" />
              </div>
              <div className="max-w-[75%] min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-xs">Ethan</span>
                  <span className="text-[10px] text-black/70 font-mono">
                    {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm">
                  <div className="mb-3 p-3 border-2 border-brutal-black bg-brutal-yellow shadow-brutal-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Settings size={16} className="text-black" />
                      <span className="font-bold text-sm">占位文字处理</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          updateFieldDeletePlaceholder(currentField.id, true)
                          setPendingPlaceholderConfirm(null)
                          addBubble('agent', `已选择**删除**占位文字。现在可以输入内容了。`)
                        }}
                        disabled={isProcessing}
                        className="btn-brutal bg-brutal-pink flex-1 text-sm disabled:opacity-50"
                      >
                        <X size={14} color="white" className="inline mr-1" />
                        删除占位文字
                      </button>
                      <button
                        onClick={() => {
                          updateFieldDeletePlaceholder(currentField.id, false)
                          setPendingPlaceholderConfirm(null)
                          addBubble('agent', `已选择**保留**占位文字。现在可以输入内容了。`)
                        }}
                        disabled={isProcessing}
                        className="btn-brutal bg-brutal-yellow flex-1 text-sm disabled:opacity-50"
                      >
                        <Check size={14} color="#141111" className="inline mr-1" />
                        保留占位文字
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* 填写方案进度显示 */}
        {methodProgress.length > 0 && (
          <div className="flex gap-3 px-4 py-2">
            <div className="w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1" style={{ backgroundColor: '#F472B6' }}>
              <FileInput size={16} color="#141111" />
            </div>
            <div className="bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm min-w-[300px]">
              <div className="text-xs font-bold mb-2">填写方案进度：</div>
              <div className="space-y-2">
                {methodProgress.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {item.status === 'trying' && (
                      <>
                        <div className="w-4 h-4 border-2 border-brutal-black animate-spin">
                          <div className="w-full h-full bg-brutal-yellow"></div>
                        </div>
                        <span className="font-medium">{item.method} - 尝试中...</span>
                      </>
                    )}
                    {item.status === 'success' && (
                      <>
                        <div className="w-4 h-4 border-2 border-brutal-black bg-brutal-green flex items-center justify-center">
                          <Check size={12} color="#141111" strokeWidth={3} />
                        </div>
                        <span className="font-medium">{item.method} - 成功</span>
                      </>
                    )}
                    {item.status === 'failed' && (
                      <>
                        <div className="w-4 h-4 border-2 border-brutal-black bg-brutal-pink flex items-center justify-center">
                          <X size={12} color="#141111" strokeWidth={3} />
                        </div>
                        <span className="font-medium line-through opacity-60">{item.method} - 失败</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 填写方式选择器 - 在用户说"完成"后显示 */}
        {showFillMethodSelector && (
          <div className="flex gap-3 px-4 py-2">
            <div className="w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1" style={{ backgroundColor: '#F472B6' }}>
              <FileInput size={16} color="#141111" />
            </div>
            <div className="max-w-[75%] min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-xs">Ethan</span>
                <span className="text-[10px] text-black/70 font-mono">
                  {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm">
                <div className="mb-3 p-3 border-2 border-brutal-black bg-brutal-yellow shadow-brutal-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings size={16} className="text-black" />
                    <span className="font-bold text-sm">选择文档生成方式</span>
                  </div>
                  <div className="relative mb-3 fill-method-dropdown">
                    <button
                      type="button"
                      onClick={() => !isProcessing && setShowDropdown(!showDropdown)}
                      className="select-brutal w-full text-sm font-medium flex items-center justify-between"
                      disabled={isProcessing}
                    >
                      <span className="truncate">
                        {fillMethod === 'word-com' && 'Word COM 自动化（推荐，100% 保留格式）'}
                        {fillMethod === 'dom-parser' && 'DOMParser 解析（备用方案）'}
                        {fillMethod === 'regex' && '正则匹配（兼容模式）'}
                      </span>
                      <ChevronDown size={16} className="flex-shrink-0 ml-2" />
                    </button>
                    {showDropdown && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 border-2 border-brutal-black bg-white shadow-brutal-sm">
                        <button
                          type="button"
                          onClick={() => { setFillMethod('word-com'); setShowDropdown(false) }}
                          className={`w-full text-left px-4 py-2 text-sm font-medium border-b border-brutal-black hover:bg-brutal-yellow ${fillMethod === 'word-com' ? 'bg-brutal-cream' : ''}`}
                        >
                          Word COM 自动化（推荐，100% 保留格式）
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFillMethod('dom-parser'); setShowDropdown(false) }}
                          className={`w-full text-left px-4 py-2 text-sm font-medium border-b border-brutal-black hover:bg-brutal-yellow ${fillMethod === 'dom-parser' ? 'bg-brutal-cream' : ''}`}
                        >
                          DOMParser 解析（备用方案）
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFillMethod('regex'); setShowDropdown(false) }}
                          className={`w-full text-left px-4 py-2 text-sm font-medium hover:bg-brutal-yellow ${fillMethod === 'regex' ? 'bg-brutal-cream' : ''}`}
                        >
                          正则匹配（兼容模式）
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      setShowFillMethodSelector(false)
                      await handleFillComplete()
                    }}
                    disabled={isProcessing}
                    className="btn-brutal bg-brutal-pink w-full text-sm disabled:opacity-50"
                  >
                    <Check size={16} color="white" className="inline mr-1" />
                    生成文档
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="border-t-2 border-brutal-black bg-white p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <button
            onClick={() => {
              if (currentFieldIndex > 0) {
                setCurrentFieldIndex(currentFieldIndex - 1)
                const prevId = fillOrder[currentFieldIndex - 1]
                const prevField = activeDocument.fields.find(f => f.id === prevId)
                if (prevField) {
                  addBubble('agent', `回到第 ${currentFieldIndex} / ${fillOrder.length} 项：**${prevField.label}**

${prevField.placeholder ? `> ${prevField.placeholder}` : ''}
${prevField.value ? `当前值：${prevField.value}` : ''}`)
                }
              }
            }}
            disabled={currentFieldIndex === 0}
            className="tab-brutal text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={12} />上一个
          </button>
          <button
            onClick={goToNext}
            disabled={currentFieldIndex >= fillOrder.length - 1}
            className="tab-brutal text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一个<ChevronRight size={12} />
          </button>
          <button
            onClick={() => {
              const curId = fillOrder[currentFieldIndex]
              const curField = activeDocument.fields.find(f => f.id === curId)
              if (curField) handleAIGenerate(curField)
            }}
            disabled={isProcessing}
            className="tab-brutal text-xs flex items-center gap-1 bg-brutal-green disabled:opacity-50"
          >
            <Wand2 size={12} />AI 生成
          </button>
          <button
            onClick={() => {
              addBubble('user', '完成')
              addBubble('agent', `所有字段已填写完毕！请选择文档生成方式：`)
              setShowFillMethodSelector(true)
            }}
            disabled={isProcessing}
            className="tab-brutal text-xs flex items-center gap-1 bg-brutal-yellow disabled:opacity-50"
          >
            <Check size={12} />完成
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-black/70 font-mono">
            第 {currentFieldIndex + 1} / {fillOrder.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={pendingPlaceholderConfirm ? "请先选择占位文字处理方式" : "输入内容，或说 'AI 生成'、'跳过'、'完成'..."}
            className="input-brutal flex-1 text-sm"
            disabled={isProcessing || !!pendingPlaceholderConfirm}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isProcessing || !!pendingPlaceholderConfirm}
            className="btn-brutal bg-brutal-pink p-2.5 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={16} color="white" />
          </button>
        </div>
      </div>
    </div>
  )
}
