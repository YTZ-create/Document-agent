import React, { useState, useEffect, useRef } from 'react'
import { Check, Square, FileInput, ChevronLeft } from 'lucide-react'
import { useFormFillStore } from '../../stores/formFillStore'

export const FieldSelector: React.FC = () => {
  const { activeDocument, setFormFillPhase, setCurrentFieldIndex, setSelectedFieldIds } = useFormFillStore()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const hasInitializedRef = useRef(false)

  // 默认全选 - 只在首次渲染时自动全选
  useEffect(() => {
    if (activeDocument && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      setSelectedIds(new Set(activeDocument.fields.map(f => f.id)))
    }
  }, [activeDocument])

  if (!activeDocument) return null

  const totalCount = activeDocument.fields.length
  const selectedCount = selectedIds.size

  const toggleField = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === totalCount) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(activeDocument.fields.map(f => f.id)))
    }
  }

  const startFilling = () => {
    if (selectedIds.size === 0) return
    // 保存选中的字段 ID 到 store
    const ids = activeDocument.fields.filter(f => selectedIds.has(f.id)).map(f => f.id)
    setSelectedFieldIds(ids)
    // 切换到填写阶段
    setFormFillPhase('fill')
    setCurrentFieldIndex(0)
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
          <div className="text-[10px] text-black/70 font-mono">{activeDocument.fileName}</div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[400px] overflow-y-auto">
        {/* 说明 */}
        <div className="bg-brutal-cream border-2 border-l-4 border-brutal-black p-3 mb-3">
          <div className="text-sm font-bold mb-1">请勾选需要填写的字段</div>
          <div className="text-xs text-black/70">从文档中提取到 {totalCount} 个待填项，勾选后逐个填写。</div>
        </div>

        {/* 全选按钮 */}
        <button
          onClick={toggleAll}
          className="tab-brutal text-xs mb-3 flex items-center gap-1.5"
        >
          {selectedCount === totalCount ? <Square size={14} /> : <Check size={14} />}
          {selectedCount === totalCount ? '取消全选' : '全选'}
        </button>

        {/* 字段列表 */}
        <div className="space-y-1.5">
          {activeDocument.fields.map((field, i) => {
            const checked = selectedIds.has(field.id)
            return (
              <div
                key={field.id}
                onClick={() => toggleField(field.id)}
                className={`flex items-start gap-2.5 p-2.5 border-2 border-brutal-black cursor-pointer transition-all
                  ${checked ? 'bg-brutal-yellow shadow-brutal-sm' : 'bg-white'}
                  hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-brutal-sm`}
              >
                <div className={`w-5 h-5 border-2 border-brutal-black flex-shrink-0 flex items-center justify-center mt-0.5
                  ${checked ? 'bg-brutal-black' : 'bg-white'}`}>
                  {checked && <Check size={12} color="#FFFAEF" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">{field.label}</div>
                  {field.placeholder && (
                    <div className="text-[11px] text-black/60 mt-0.5">{field.placeholder}</div>
                  )}
                </div>
                <div className="text-[10px] font-mono text-black/50 flex-shrink-0 mt-0.5">#{i + 1}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t-2 border-brutal-black bg-white p-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 text-xs text-black/70">
            已选 <span className="font-bold text-brutal-black">{selectedCount}</span> / {totalCount} 个字段
          </div>
          <button
            onClick={startFilling}
            disabled={selectedCount === 0}
            className="btn-brutal bg-brutal-pink px-4 py-2 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Check size={14} color="white" /> 开始填写
          </button>
        </div>
      </div>
    </div>
  )
}
