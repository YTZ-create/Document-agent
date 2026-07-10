import { create } from 'zustand'
import type { FormField, FormDocument } from '../agents/formFiller'
import type { FileEntry } from '../api/platformAPI'
import { useChatStore } from './chatStore'
import type { FillMethod } from '../utils/docxHandler'

interface FormFillState {
  activeDocument: FormDocument | null
  isProcessing: boolean
  isFormFillingSession: boolean
  formFillPhase: 'file-select' | 'select' | 'fill' | null
  selectedFieldIds: string[]
  availableFiles: FileEntry[]
  fillMethod: FillMethod

  setActiveDocument: (doc: FormDocument | null) => void
  setIsProcessing: (v: boolean) => void
  setIsFormFillingSession: (v: boolean) => void
  setFormFillPhase: (phase: 'file-select' | 'select' | 'fill' | null) => void
  setSelectedFieldIds: (ids: string[]) => void
  setAvailableFiles: (files: FileEntry[]) => void
  setCurrentFieldIndex: (index: number) => void
  updateField: (fieldId: string, value: string, filledBy: 'user' | 'ai') => void
  updateFieldDeletePlaceholder: (fieldId: string, deletePlaceholder: boolean) => void
  nextField: () => void
  prevField: () => void
  setStatus: (status: FormDocument['status']) => void
  setFillMethod: (method: FillMethod) => void
  endSession: (filledFilePath?: string) => void
}

export const useFormFillStore = create<FormFillState>((set, get) => ({
  activeDocument: null,
  isProcessing: false,
  isFormFillingSession: false,
  formFillPhase: null,
  selectedFieldIds: [],
  availableFiles: [],
  fillMethod: 'word-com' as FillMethod,

  setActiveDocument: (doc) => set({ activeDocument: doc }),
  setIsProcessing: (v) => set({ isProcessing: v }),
  setIsFormFillingSession: (v) => set({ isFormFillingSession: v }),
  setFormFillPhase: (phase) => set({ formFillPhase: phase }),
  setSelectedFieldIds: (ids) => set({ selectedFieldIds: ids }),
  setAvailableFiles: (files) => set({ availableFiles: files }),

  setCurrentFieldIndex: (index) =>
    set((s) => {
      if (!s.activeDocument) return s
      return { activeDocument: { ...s.activeDocument, currentFieldIndex: index } }
    }),

  updateField: (fieldId, value, filledBy) =>
    set((s) => {
      if (!s.activeDocument) return s
      const fields = s.activeDocument.fields.map((f) =>
        f.id === fieldId ? { ...f, value, filledBy } : f
      )
      return { activeDocument: { ...s.activeDocument, fields } }
    }),

  updateFieldDeletePlaceholder: (fieldId, deletePlaceholder) =>
    set((s) => {
      if (!s.activeDocument) return s
      const fields = s.activeDocument.fields.map((f) =>
        f.id === fieldId ? { ...f, deletePlaceholder } : f
      )
      return { activeDocument: { ...s.activeDocument, fields } }
    }),

  nextField: () => {
    const { activeDocument } = get()
    if (!activeDocument || activeDocument.fields.length === 0) return
    const nextIdx = Math.min(activeDocument.currentFieldIndex + 1, activeDocument.fields.length - 1)
    set({ activeDocument: { ...activeDocument, currentFieldIndex: nextIdx } })
  },

  prevField: () => {
    const { activeDocument } = get()
    if (!activeDocument || activeDocument.fields.length === 0) return
    const prevIdx = Math.max(activeDocument.currentFieldIndex - 1, 0)
    set({ activeDocument: { ...activeDocument, currentFieldIndex: prevIdx } })
  },

  setStatus: (status) =>
    set((s) => {
      if (!s.activeDocument) return s
      return { activeDocument: { ...s.activeDocument, status } }
    }),

  setFillMethod: (method) => set({ fillMethod: method }),

  endSession: (filledFilePath?: string) => {
    // 如果最后一条 Agent 消息还是过时的填写提示，更新为结束语
    const state = useChatStore.getState()
    const msgs = state.messages
    const lastIdx = msgs.length - 1
    if (lastIdx >= 0 && msgs[lastIdx].role === 'agent') {
      const lastContent = msgs[lastIdx].content
      const stalePatterns = ['请在下方勾选', '开始填写', '提取到', '待填项']
      if (stalePatterns.some(p => lastContent.includes(p))) {
        const endMsg = filledFilePath
          ? `✅ 表单填写会话已结束。填写后的文件已保存至：\n${filledFilePath}\n\n如需继续填写，请重新发送文档。`
          : '✅ 表单填写会话已结束。如需继续填写，请重新发送文档。'
        state.updateLastMessage(endMsg)
      }
    }
    set({
      activeDocument: null,
      isFormFillingSession: false,
      formFillPhase: null,
      selectedFieldIds: [],
      availableFiles: [],
      isProcessing: false,
    })
  },
}))
