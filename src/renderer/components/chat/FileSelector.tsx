import React, { useState, useEffect } from 'react'
import { Check, FileText, FileInput, ChevronLeft, Loader2 } from 'lucide-react'
import { useFormFillStore } from '../../stores/formFillStore'
import { agentRegistry } from '../../agents/registry'
import { FormFillerAgent, type FormDocument } from '../../agents/formFiller'
import { useChatStore } from '../../stores/chatStore'
import type { FileEntry } from '../../api/platformAPI'

export const FileSelector: React.FC = () => {
  const {
    availableFiles, setFormFillPhase, setAvailableFiles,
    setActiveDocument,
  } = useFormFillStore()
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 如果只有一个文件，默认选中
  useEffect(() => {
    if (availableFiles.length === 1 && !selectedFile) {
      setSelectedFile(availableFiles[0])
    }
  }, [availableFiles])

  const handleConfirm = async () => {
    if (!selectedFile || extracting) return
    setExtracting(true)
    setError(null)

    // 获取 FormFillerAgent 实例
    const agent = agentRegistry.get('form-filler')
    if (!agent || !(agent instanceof FormFillerAgent)) {
      setExtracting(false)
      return
    }

    // 更新消息为提取中
    const lastMsg = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
    if (lastMsg && lastMsg.role === 'agent') {
      useChatStore.getState().updateLastMessage(`正在分析 **${selectedFile.name}**，提取待填项...`)
    }

    try {
      console.log('[FileSelector] Starting extractFieldsFromDoc for:', selectedFile.path)
      console.log('[FileSelector] File details:', { name: selectedFile.name, ext: selectedFile.ext, path: selectedFile.path, size: selectedFile.size })
      const { fields, content, rawContent } = await agent.extractFieldsFromDoc(selectedFile.path)
      console.log('[FileSelector] Extracted fields:', fields.length, 'content length:', content.length)
      const doc: FormDocument = {
        filePath: selectedFile.path,
        fileName: selectedFile.name,
        originalContent: content,
        rawContent,
        fields,
        currentFieldIndex: 0,
        status: 'filling',
      }
      setActiveDocument(doc)

      // 更新消息
      const lastMsg2 = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
      if (lastMsg2 && lastMsg2.role === 'agent') {
        useChatStore.getState().updateLastMessage(`已从 **${selectedFile.name}** 中提取到 **${fields.length}** 个待填项。\n\n请在下方勾选需要填写的字段，然后点击"开始填写"。`)
      }

      // 进入字段勾选阶段，清空文件列表
      setAvailableFiles([])
      setFormFillPhase('select')
    } catch (err: any) {
      console.error('[FileSelector] extractFieldsFromDoc failed:', err)
      setError(err.message || '分析失败')
      const lastMsg2 = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]
      if (lastMsg2 && lastMsg2.role === 'agent') {
        useChatStore.getState().updateLastMessage(`❌ 分析失败: ${err.message}\n\n文件: ${selectedFile.name}\n路径: ${selectedFile.path}\n\n请检查文件是否为有效的文档格式（.docx, .pdf, .txt 等）。`)
      }
      setExtracting(false)
    }
  }

  return (
    <div className="mx-4 my-2 bg-white border-2 border-brutal-black shadow-brutal-sm">
      {/* Header */}
      <div className="border-b-2 border-brutal-black bg-brutal-yellow px-4 py-3 flex items-center gap-2">
        <div className="w-8 h-8 border-2 border-brutal-black flex items-center justify-center" style={{ backgroundColor: '#F472B6' }}>
          <FileInput size={16} color="#141111" style={{ transform: 'scaleX(-1)' }} />
        </div>
        <div className="flex-1">
          <div className="font-bold text-sm">Ethan · 信息采集助手</div>
          <div className="text-[10px] text-black/70 font-mono">
            {extracting ? '正在分析文档...' : '请选择要填写的文档'}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[300px] overflow-y-auto">
        <div className="bg-brutal-cream border-2 border-l-4 border-brutal-black p-3 mb-3">
          <div className="text-sm font-bold mb-1">请选择要填写的文档</div>
          <div className="text-xs text-black/70">从文件夹中找到 {availableFiles.length} 个文档，请选择一个。</div>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-l-4 border-red-500 p-3 mb-3">
            <div className="text-sm font-bold text-red-700 mb-1">分析失败</div>
            <div className="text-xs text-red-600">{error}</div>
          </div>
        )}

        <div className="space-y-1.5">
          {availableFiles.map((file) => {
            const isSelected = selectedFile?.path === file.path
            return (
              <div
                key={file.path}
                onClick={() => !extracting && setSelectedFile(file)}
                className={`flex items-center gap-2.5 p-2.5 border-2 border-brutal-black transition-all
                  ${extracting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm'}
                  ${isSelected ? 'bg-brutal-yellow shadow-brutal-sm' : 'bg-white'}`}
              >
                <div className={`w-5 h-5 border-2 border-brutal-black flex-shrink-0 flex items-center justify-center
                  ${isSelected ? 'bg-brutal-black' : 'bg-white'}`}>
                  {isSelected && <Check size={12} color="#FFFAEF" strokeWidth={3} />}
                </div>
                <FileText size={14} className="flex-shrink-0 text-black/60" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{file.name}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t-2 border-brutal-black bg-white p-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 text-xs text-black/70">
            {extracting ? (
              <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在提取字段...</span>
            ) : selectedFile ? (
              <span>已选择：<span className="font-bold text-brutal-black truncate">{selectedFile.name}</span></span>
            ) : (
              <span>请选择一个文档</span>
            )}
          </div>
          <button
            onClick={handleConfirm}
            disabled={!selectedFile || extracting}
            className="btn-brutal bg-brutal-pink px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {extracting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} color="white" />}
            {extracting ? '提取中' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
