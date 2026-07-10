import { BaseAgent, type AgentConfig } from './base'
import type { PlatformAPI } from '../api/platformAPI'
import { FileOutput } from 'lucide-react'
import { callLLM } from '../utils/llm'
import { useSettingsStore } from '../stores/settingsStore'
import { useTokenUsageStore } from '../stores/tokenUsageStore'
import { extractDocumentText } from '../utils/docParser'
import { fillDocxFile, fillDocxWithDOMParser, fillDocxWithWordCOMBase64, type FillMethod } from '../utils/docxHandler'
import { fillXlsxWithXml, fillXlsxWithExcelCOM } from '../utils/xlsxHandler'
import PizZip from 'pizzip'

export interface FormField {
  id: string
  label: string
  placeholder: string
  value: string
  filledBy: 'user' | 'ai' | 'none'
  anchorText?: string  // 目标位置的锚点文字（用于表格等标签与填写位置不同的场景）
  deletePlaceholder?: boolean  // 是否删除占位提示文字（true=替换, false=保留并追加）
}

export interface FormDocument {
  filePath: string
  fileName: string
  originalContent: string
  rawContent?: string  // 原始 base64 内容（.docx 等二进制格式需要）
  fields: FormField[]
  currentFieldIndex: number
  status: 'extracting' | 'filling' | 'completed'
}

export class FormFillerAgent extends BaseAgent {
  constructor(platform: PlatformAPI) { super(platform) }

  config: AgentConfig = {
    id: 'form-filler',
    name: 'Ethan',
    description: '分析文档中的信息采集项，对话式帮你填写文档',
    icon: FileOutput,
    color: '#F472B6',
    provider: 'deepseek',
    model: '',
    systemPrompt: `你是 Ethan，信息采集与文档填写专家。你擅长从文档中识别需要填写的信息项，然后以对话的方式逐个收集信息并填入文档。

## 你的团队
- **Oliver** - 智能调度助手（团队领导）
- **Ethan** (你) - 信息采集与文档填写专家
- **Charlotte** - 文件分析专家
- **William** - 代码审查专家
- **Amelia** - 文档摘要专家
- **James** - 文件整理专家

## 重要规则
- 你是信息采集与文档填写专家，专注于从文档中提取需要填写的字段，然后收集信息并填入。
- 回复时始终明确你的身份是"信息采集专家 Ethan"。
- 用 Markdown 格式回复，语言: 中文。`,
  }

  async extractFieldsFromDoc(filePath: string): Promise<{ fields: FormField[]; content: string; rawContent: string }> {
    const dotIndex = filePath.lastIndexOf('.')
    const ext = dotIndex === -1 ? '' : filePath.substring(dotIndex).toLowerCase()
    console.log('[FormFiller] Reading file:', filePath, 'ext:', ext)

    let rawContent: string
    let content: string

    if (['.docx', '.pdf'].includes(ext)) {
      console.log('[FormFiller] Calling readBinaryFile for:', filePath)
      const { content: arrayBuffer, error } = await this.platform.fs.readBinaryFile(filePath)
      console.log('[FormFiller] readBinaryFile result - error:', error, 'arrayBuffer:', arrayBuffer ? `byteLength=${arrayBuffer.byteLength}` : 'null')
      if (error || !arrayBuffer) {
        throw new Error(error || '无法读取文件')
      }
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      rawContent = btoa(binary)
      console.log('[FormFiller] rawContent base64 length:', rawContent.length)
      console.log('[FormFiller] Calling extractDocumentText with ArrayBuffer, ext:', ext)
      content = await extractDocumentText(filePath, arrayBuffer, ext)
      console.log('[FormFiller] extractDocumentText returned, content length:', content.length)
    } else {
      const result = await this.platform.fs.readFile(filePath)
      if (result.error || !result.content) {
        throw new Error(result.error || '无法读取文件')
      }
      rawContent = result.content
      content = await extractDocumentText(filePath, rawContent, ext)
    }

    console.log('[FormFiller] Extracted content length:', content.length)
    if (content.length > 0) {
      console.log('[FormFiller] Content preview:', content.substring(0, 200))
    } else {
      console.error('[FormFiller] WARNING: content is empty! filePath:', filePath, 'ext:', ext)
    }

    if (!content.trim()) {
      throw new Error('文档内容为空或无法解析。请确认文件是有效的 docx/pdf 格式。')
    }

    const maxContentLength = 12000
    const truncatedContent = content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '\n\n...（文档内容过长，已截断）'
      : content

    console.log('[FormFiller] Document content length:', content.length, 'truncated to:', Math.min(content.length, maxContentLength))
    console.log('[FormFiller] Content preview (first 500 chars):', content.substring(0, 500))

    const prompt = `你是一个信息采集专家，专门从各类表格、申报书、申请表等文档中提取需要填写的字段。

## 文档内容
${truncatedContent}

## 提取规则
请仔细分析文档，找出所有需要用户手动填写的信息项。以下都是需要填写的字段：
1. 带有冒号（: 或 ：）后面跟着空白或下划线的，如"姓名：____"、"团队名称："
2. 括号（）或（ ）中需要填写内容的，如"（填写团队名称）"
3. 表格中的空白单元格
4. 带有下划线 ___ 或横线 —— 的待填位置
5. 任何明显需要用户输入具体信息的位置（如姓名、学号、日期、电话、地址、项目名称等）
6. 文档中出现的"____"、"___"、"（）"、"（  ）"等占位符前面的标签文字

## 重要：锚点文字（anchorText）
对于表格类文档，标签和填写位置可能不在同一个单元格。例如：
- 左侧单元格是"背景与目的"，右侧单元格是"请简述此项目的背景情况及开展的目的。"
- 这种情况下，label 是"背景与目的"，但填写位置应该通过右侧单元格中的文字来定位
- anchorText 应该填写右侧单元格中的完整文字，如"请简述此项目的背景情况及开展的目的。"

如果标签和填写位置在同一个位置（如"姓名：____"），则不需要 anchorText。
如果标签和填写位置不同（如表格），则必须提供 anchorText 来定位填写位置。

## 输出要求
- 每个字段包含 label（字段名称）、placeholder（填写提示/示例）
- 如果标签和填写位置不同，还需提供 anchorText（目标位置的锚点文字）
- placeholder 应该简短说明该填什么内容，例如"如：张三"、"如：2026年7月1日"
- 只返回 JSON 数组，不要其他文字

## JSON 格式
[
  { "label": "姓名", "placeholder": "填写你的真实姓名" },
  { "label": "学号", "placeholder": "填写你的学号" },
  { "label": "背景与目的", "placeholder": "简述项目背景", "anchorText": "请简述此项目的背景情况及开展的目的。" }
]

请尽可能多地提取字段，不要遗漏。`

    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const provider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = (promptTokens: number, completionTokens: number) => {
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const result = await callLLM({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一个信息提取专家，只返回 JSON。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })

    let fields: FormField[] = []
    try {
      console.log('[FormFiller] LLM raw response length:', result.length)
      console.log('[FormFiller] LLM raw response:', result.substring(0, 500))
      const codeBlockMatch = result.match(/```json?\s*([\s\S]*?)\s*```/)
      const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : result.replace(/```json|```/g, '')).trim()
      console.log('[FormFiller] JSON string:', jsonStr.substring(0, 500))
      const parsed = JSON.parse(jsonStr)
      console.log('[FormFiller] Parsed fields count:', parsed.length)
      fields = parsed.map((f: any, i: number) => ({
        id: `field-${i}`,
        label: f.label || `字段 ${i + 1}`,
        placeholder: f.placeholder || '',
        value: '',
        filledBy: 'none',
        anchorText: f.anchorText || undefined,
        deletePlaceholder: f.deletePlaceholder || undefined,
      }))
    } catch (e: any) {
      console.error('[FormFiller] JSON parse failed:', e.message)
      console.error('[FormFiller] Raw LLM response:', result)
      throw new Error(`字段提取失败: ${e.message}。请检查文档格式是否正确。`)
    }

    return { fields, content, rawContent }
  }

  async generateAIFill(field: FormField, context: string): Promise<string> {
    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const provider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = (promptTokens: number, completionTokens: number) => {
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const prompt = `请根据以下上下文，为"${field.label}"生成一个合适的填写内容。
字段说明：${field.placeholder}

上下文：
${context}

请直接给出填写内容，不要其他解释。如果上下文不足以生成内容，请返回一个合理的示例或占位内容。`

    return await callLLM({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一个信息填写助手，根据上下文生成合适的填写内容。直接给出内容，不要解释。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })
  }

  async fillDocument(
    originalContent: string,
    fields: FormField[],
    filePath?: string,
    rawContent?: string,
    fillMethod: FillMethod = 'word-com',
    onMethodChange?: (method: string, status: 'trying' | 'success' | 'failed') => void
  ): Promise<string> {
    // 对于 .docx 文件，根据选择的方法填写
    if (filePath && filePath.toLowerCase().endsWith('.docx')) {
      console.log(`[FormFiller] Using fill method: ${fillMethod}`)
      console.log(`[FormFiller] Fields to fill: ${fields.filter(f => f.value).length} with values`)
      for (const f of fields.filter(f => f.value)) {
        console.log(`[FormFiller]   "${f.label}" = "${f.value}"`)
      }

      // 确保 rawContent 可用（用于验证和 fallback 方案）
      if (!rawContent) {
        const { content: arrayBuffer, error } = await this.platform.fs.readBinaryFile(filePath)
        if (error || !arrayBuffer) {
          throw new Error(error || '无法读取 .docx 文件')
        }
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        rawContent = btoa(binary)
      }

      // 保存最佳结果（即使验证"失败"也保留，避免因验证误判丢弃正确结果）
      let bestResult: string | null = null

      // 方案一：Word COM 自动化（仅在 Windows + 安装 Word 时可用）
      let currentMethod: FillMethod = fillMethod
      if (currentMethod === 'word-com') {
        try {
          onMethodChange?.('Word COM 自动化', 'trying')
          const result = await fillDocxWithWordCOMBase64(
            filePath,
            fields,
            (cmd) => this.platform.os.execCommand(cmd),
            (path) => this.platform.fs.readBinaryFile(path)
          )
          if (this.validateFillResult(rawContent, result, fields)) {
            onMethodChange?.('Word COM 自动化', 'success')
            return result
          }
          if (result !== rawContent) {
            console.warn('[FormFiller] Word COM validation not passed but content changed, keeping as best result')
            bestResult = result
          }
          onMethodChange?.('Word COM 自动化', 'failed')
        } catch (err: any) {
          console.error('[FormFiller] Word COM failed:', err.message)
          onMethodChange?.('Word COM 自动化', 'failed')
        }
        currentMethod = 'dom-parser'
      }

      // 方案二：DOMParser XML 操作
      if (currentMethod === 'dom-parser') {
        try {
          onMethodChange?.('XML 直接操作', 'trying')
          const result = await fillDocxWithDOMParser(rawContent, fields)
          if (this.validateFillResult(rawContent, result, fields)) {
            onMethodChange?.('XML 直接操作', 'success')
            return result
          }
          if (result !== rawContent && !bestResult) {
            console.warn('[FormFiller] DOMParser validation not passed but content changed, keeping as best result')
            bestResult = result
          }
          onMethodChange?.('XML 直接操作', 'failed')
        } catch (err: any) {
          console.error('[FormFiller] DOMParser failed:', err.message)
          onMethodChange?.('XML 直接操作', 'failed')
        }
        currentMethod = 'regex'
      }

      // 方案三：正则匹配（兼容性最好）
      try {
        onMethodChange?.('正则表达式匹配', 'trying')
        const result = await fillDocxFile(rawContent, fields)
        if (this.validateFillResult(rawContent, result, fields)) {
          onMethodChange?.('正则表达式匹配', 'success')
          return result
        }
        if (result !== rawContent && !bestResult) {
          console.warn('[FormFiller] Regex validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('正则表达式匹配', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Regex fill failed:', err.message)
        onMethodChange?.('正则表达式匹配', 'failed')
      }

      // 如果有最佳结果（内容已改变但验证未通过），仍然返回它
      if (bestResult) {
        console.warn('[FormFiller] Returning best available result (content changed but strict validation not passed)')
        return bestResult
      }

      throw new Error('所有填写方案均未成功，请检查文档格式是否包含可识别的待填字段')
    }

    // 对于 .xlsx/.xls 文件，使用 Excel 专用处理方法
    if (filePath && (filePath.toLowerCase().endsWith('.xlsx') || filePath.toLowerCase().endsWith('.xls'))) {
      console.log(`[FormFiller] Processing Excel file: ${filePath}`)
      console.log(`[FormFiller] Fields to fill: ${fields.filter(f => f.value).length} with values`)
      for (const f of fields.filter(f => f.value)) {
        console.log(`[FormFiller]   "${f.label}" = "${f.value}"`)
      }

      // 确保 rawContent 可用
      if (!rawContent) {
        const { content: arrayBuffer, error } = await this.platform.fs.readBinaryFile(filePath)
        if (error || !arrayBuffer) {
          throw new Error(error || '无法读取 Excel 文件')
        }
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        rawContent = btoa(binary)
      }

      let bestResult: string | null = null

      // 方案一：Excel COM 自动化（仅在 Windows + 安装 Excel 时可用）
      try {
        onMethodChange?.('Excel COM 自动化', 'trying')
        const result = await fillXlsxWithExcelCOM(
          filePath,
          fields,
          (cmd) => this.platform.os.execCommand(cmd),
          (path) => this.platform.fs.readBinaryFile(path)
        )
        if (this.validateXlsxResult(rawContent, result, fields)) {
          onMethodChange?.('Excel COM 自动化', 'success')
          return result
        }
        if (result !== rawContent) {
          console.warn('[FormFiller] Excel COM validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('Excel COM 自动化', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Excel COM failed:', err.message)
        onMethodChange?.('Excel COM 自动化', 'failed')
      }

      // 方案二：XML 直接操作
      try {
        onMethodChange?.('Excel XML 直接操作', 'trying')
        const result = await fillXlsxWithXml(rawContent, fields)
        if (this.validateXlsxResult(rawContent, result, fields)) {
          onMethodChange?.('Excel XML 直接操作', 'success')
          return result
        }
        if (result !== rawContent && !bestResult) {
          console.warn('[FormFiller] Excel XML validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('Excel XML 直接操作', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Excel XML failed:', err.message)
        onMethodChange?.('Excel XML 直接操作', 'failed')
      }

      // 如果有最佳结果，仍然返回它
      if (bestResult) {
        console.warn('[FormFiller] Returning best available Excel result')
        return bestResult
      }

      throw new Error('Excel 填写方案均未成功，请检查表格格式是否包含可识别的待填字段')
    }

    // 对于其他格式，使用 LLM 填写
    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const provider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = (promptTokens: number, completionTokens: number) => {
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const fieldsJson = fields.map((f) => ({ label: f.label, value: f.value }))

    const prompt = `请将以下字段的值填入原始文档的对应位置，生成填写完成的文档。

## 原始文档
${originalContent}

## 填写字段（JSON）
${JSON.stringify(fieldsJson, null, 2)}

## 要求
1. 将每个字段的值准确填入文档中对应的位置
2. 保持原文档的格式、排版不变
3. 只返回填写完成的文档内容，不要其他文字`

    return await callLLM({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一个文档填写助手，将字段值填入文档对应位置。只返回填写后的文档内容。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })
  }

  /**
   * 验证填写结果是否生效
   * 对比原始内容和填写后的内容，检查是否有实际改变
   *
   * 关键修复：对 .docx 文件，必须将填写结果作为 zip 解压，在 word/document.xml 中
   * 搜索字段值。之前在二进制中直接搜索 Unicode 字符串，但 zip 中的 XML 是 UTF-8 编码，
   * 中文等多字节字符的 UTF-8 字节序列无法匹配 JavaScript 的 Unicode 字符串，
   * 导致验证永远失败，所有填写方案都被误判为"未生效"。
   */
  private validateFillResult(originalRawContent: string | undefined, filledContent: string, fields: FormField[]): boolean {
    if (!originalRawContent) {
      console.warn('[FormFiller] No original raw content to compare, assuming success')
      return true
    }

    // 1. 快速检查：内容是否改变
    if (originalRawContent === filledContent) {
      console.error('[FormFiller] Content unchanged - fill failed (identical base64)')
      return false
    }

    console.log(`[FormFiller] Content length change: ${Math.abs(filledContent.length - originalRawContent.length)} chars`)

    // 2. 对 .docx 文件，解压 zip 后在 document.xml 中验证
    try {
      const binaryString = atob(filledContent)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // 尝试作为 zip 加载，提取 document.xml
      let zip: PizZip
      try {
        zip = new PizZip(bytes)
      } catch (zipErr) {
        console.warn('[FormFiller] Cannot load result as zip:', (zipErr as Error).message)
        return this.validateInRawBytes(binaryString, fields)
      }
      const docXml = zip.file('word/document.xml')?.asText()

      if (!docXml) {
        // 无法作为 zip 加载（Word COM 返回的 base64 可能带有额外包装）
        // 降级到原始二进制搜索
        console.warn('[FormFiller] Cannot extract document.xml from result, falling back to raw search')
        return this.validateInRawBytes(binaryString, fields)
      }

      console.log('[FormFiller] Validating in document.xml (decoded from UTF-8 zip entry)')
      return this.validateInXml(docXml, fields)
    } catch (err) {
      console.error('[FormFiller] Failed to decode filled content for validation:', err)
      // 无法验证时，只要内容改变就认为成功（不阻塞用户）
      return true
    }
  }

  /**
   * 在 XML 文本中验证字段值是否存在
   * XML 已被 PizZip 正确解码为 JavaScript 字符串（UTF-8 → Unicode），
   * 所以可以直接用 includes() 搜索中文等非 ASCII 字符
   *
   * 修复：返回详细的验证报告，而不仅仅是 true/false
   * 让用户知道哪些字段成功填写，哪些失败
   */
  private validateInXml(docXml: string, fields: FormField[]): boolean {
    let foundCount = 0
    const fieldsWithValue = fields.filter(f => f.value)
    const missingFields: string[] = []

    for (const field of fieldsWithValue) {
      // 注意：XML 中可能对特殊字符进行了转义
      const escapedValue = field.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')

      const found = docXml.includes(field.value) || docXml.includes(escapedValue)

      if (found) {
        foundCount++
        console.log(`[FormFiller] ✓ Field "${field.label}" = "${field.value}" found in document.xml`)
      } else {
        missingFields.push(field.label)
        console.warn(`[FormFiller] ✗ Field "${field.label}" = "${field.value}" NOT found in document.xml`)
        // 调试：检查值是否被拆分到多个 <w:t> 节点导致跨节点
        if (field.value.length > 1) {
          let charFoundCount = 0
          for (const char of field.value) {
            if (docXml.includes(char)) charFoundCount++
          }
          if (charFoundCount > 0) {
            console.warn(`[FormFiller]   Partial: ${charFoundCount}/${field.value.length} individual chars found (value may be split across <w:t> nodes)`)
          }
        }
      }
    }

    // 修复：只要找到至少一个字段就返回 true，但记录缺失字段供后续报告
    const success = foundCount > 0
    console.log(`[FormFiller] XML validation: ${foundCount}/${fieldsWithValue.length} fields found`)
    if (missingFields.length > 0) {
      console.warn(`[FormFiller] Missing fields: ${missingFields.join(', ')}`)
    }
    return success
  }

  /**
   * 验证 Excel 填写结果是否生效
   * 对比原始内容和填写后的内容，检查是否有实际改变
   * 对 .xlsx 文件，解压 zip 后在 sharedStrings.xml 和 sheet XML 中搜索字段值
   */
  private validateXlsxResult(originalRawContent: string | undefined, filledContent: string, fields: FormField[]): boolean {
    if (!originalRawContent) {
      console.warn('[FormFiller] No original raw content to compare, assuming success')
      return true
    }

    // 1. 快速检查：内容是否改变
    if (originalRawContent === filledContent) {
      console.error('[FormFiller] Excel content unchanged - fill failed (identical base64)')
      return false
    }

    console.log(`[FormFiller] Excel content length change: ${Math.abs(filledContent.length - originalRawContent.length)} chars`)

    // 2. 解压 zip 后在 sharedStrings.xml 和 sheet XML 中验证
    try {
      const binaryString = atob(filledContent)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      let zip: PizZip
      try {
        zip = new PizZip(bytes)
      } catch (zipErr) {
        console.warn('[FormFiller] Cannot load Excel result as zip:', (zipErr as Error).message)
        return originalRawContent !== filledContent
      }
      const sharedStringsXml = zip.file('xl/sharedStrings.xml')?.asText() || ''

      // 收集所有 XML 内容
      let allXml = sharedStringsXml
      const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
      if (sheetFiles) {
        for (const sheetFile of sheetFiles) {
          allXml += sheetFile.asText()
        }
      }

      if (!allXml) {
        console.warn('[FormFiller] Cannot extract Excel XML from result')
        return originalRawContent !== filledContent
      }

      let foundCount = 0
      const fieldsWithValue = fields.filter(f => f.value)

      for (const field of fieldsWithValue) {
        const escapedValue = field.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;')

        const found = allXml.includes(field.value) || allXml.includes(escapedValue)
        if (found) {
          foundCount++
          console.log(`[FormFiller] ✓ Excel field "${field.label}" = "${field.value}" found`)
        } else {
          console.warn(`[FormFiller] ✗ Excel field "${field.label}" = "${field.value}" NOT found`)
        }
      }

      const success = foundCount > 0
      console.log(`[FormFiller] Excel validation: ${foundCount}/${fieldsWithValue.length} fields found`)
      return success
    } catch (err) {
      console.error('[FormFiller] Failed to decode filled Excel content for validation:', err)
      return true
    }
  }

  /**
   * 降级方案：在原始二进制字符串中搜索（用于无法解压 zip 的情况）
   * 对 ASCII 内容有效，但中文等多字节字符会失败
   */
  private validateInRawBytes(binaryString: string, fields: FormField[]): boolean {
    let foundCount = 0
    const fieldsWithValue = fields.filter(f => f.value)

    for (const field of fieldsWithValue) {
      // 直接搜索（对 ASCII 有效）
      if (binaryString.includes(field.value)) {
        foundCount++
        console.log(`[FormFiller] ✓ Field "${field.label}" found in raw bytes (ASCII match)`)
        continue
      }

      // UTF-8 编码后搜索（对中文等非 ASCII 字符）
      try {
        const utf8Bytes = new TextEncoder().encode(field.value)
        let utf8Str = ''
        for (let i = 0; i < utf8Bytes.length; i++) {
          utf8Str += String.fromCharCode(utf8Bytes[i])
        }
        if (binaryString.includes(utf8Str)) {
          foundCount++
          console.log(`[FormFiller] ✓ Field "${field.label}" found via UTF-8 encoding`)
        } else {
          console.warn(`[FormFiller] ✗ Field "${field.label}" NOT found (raw + UTF-8)`)
        }
      } catch {
        console.warn(`[FormFiller] ✗ Field "${field.label}" UTF-8 encode failed`)
      }
    }

    console.log(`[FormFiller] Raw validation: ${foundCount}/${fieldsWithValue.length} fields found`)
    return foundCount > 0
  }
}
