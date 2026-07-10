import { PDFParse } from 'pdf-parse'
import { extractDocxText } from './docxHandler'
import PizZip from 'pizzip'

/**
 * 从文档文件中提取纯文本内容
 * 支持 .md, .txt, .html, .docx, .pdf, .csv, .json, .yaml, .yml, .xml, .rtf, .xlsx, .xls
 * @param filePath 文件路径
 * @param rawContent 文本内容（纯文本格式）或 ArrayBuffer（二进制格式如 .docx, .pdf）
 * @param ext 文件扩展名
 */
export async function extractDocumentText(filePath: string, rawContent: string | ArrayBuffer, ext: string): Promise<string> {
  const lowerExt = ext.toLowerCase()

  // 纯文本格式直接返回
  if (['.md', '.txt', '.html', '.htm', '.csv', '.json', '.yaml', '.yml', '.xml', '.rtf'].includes(lowerExt)) {
    return typeof rawContent === 'string' ? rawContent : ''
  }

  // .docx 文件 - 使用 docxHandler，需要 ArrayBuffer
  if (lowerExt === '.docx') {
    try {
      // 如果是字符串，说明调用方传错了，返回错误
      if (typeof rawContent === 'string') {
        console.error('[docParser] .docx requires ArrayBuffer, got string')
        return ''
      }

      console.log('[docParser] .docx ArrayBuffer byteLength:', rawContent.byteLength)
      const text = extractDocxText(rawContent)
      console.log('[docParser] docx extracted text length:', text.length)
      if (text.trim()) {
        console.log('[docParser] docx text preview:', text.substring(0, 300))
        return text
      }
      console.error('[docParser] docx extraction returned empty text')
    } catch (e: any) {
      console.error('[docParser] docx extraction failed:', e.message)
    }
    return ''
  }

  // .xlsx / .xls 文件 - 解析 zip 内的 sharedStrings.xml 和 sheet XML
  if (lowerExt === '.xlsx' || lowerExt === '.xls') {
    try {
      let bytes: Uint8Array
      if (typeof rawContent === 'string') {
        // 使用 TextEncoder 正确处理 UTF-8
        const encoder = new TextEncoder()
        const encoded = encoder.encode(rawContent)
        bytes = new Uint8Array(encoded)
      } else {
        bytes = new Uint8Array(rawContent)
      }

      console.log('[docParser] .xlsx ArrayBuffer byteLength:', bytes.byteLength)
      const text = extractXlsxText(bytes)
      console.log('[docParser] xlsx extracted text length:', text.length)
      if (text.trim()) {
        console.log('[docParser] xlsx text preview:', text.substring(0, 300))
        return text
      }
      console.error('[docParser] xlsx extraction returned empty text')
    } catch (e: any) {
      console.error('[docParser] xlsx extraction failed:', e.message)
    }
    return ''
  }

  // .pdf 文件 - 使用 pdf-parse 库
  if (lowerExt === '.pdf') {
    try {
      // 如果是字符串，转换为 ArrayBuffer
      let bytes: Uint8Array
      if (typeof rawContent === 'string') {
        // 使用 TextEncoder 正确处理 UTF-8
        const encoder = new TextEncoder()
        const encoded = encoder.encode(rawContent)
        bytes = new Uint8Array(encoded)
      } else {
        bytes = new Uint8Array(rawContent)
      }
      const parser = new PDFParse({ data: bytes })
      const result = await parser.getText()
      return result.text || ''
    } catch {
      return typeof rawContent === 'string' ? rawContent : ''
    }
  }

  // 未知格式返回原始内容
  return typeof rawContent === 'string' ? rawContent : ''
}

/**
 * 从 .xlsx 文件的 zip 结构中提取文本内容
 * 读取 sharedStrings.xml（共享字符串）和各 sheet XML（工作表数据）
 * 按行列位置组合成可读的文本描述
 */
function extractXlsxText(buffer: Uint8Array): string {
  const zip = new PizZip(buffer)

  // 解析 sharedStrings.xml
  const sharedStrings: string[] = []
  const ssEntry = zip.file('xl/sharedStrings.xml')
  if (ssEntry) {
    const ssXml = ssEntry.asText()
    const siRegex = /<si>([\s\S]*?)<\/si>/g
    let match
    while ((match = siRegex.exec(ssXml)) !== null) {
      const tRegex = /<t[^>]*>([^<]*)<\/t>/g
      let text = ''
      let tMatch
      while ((tMatch = tRegex.exec(match[1])) !== null) {
        text += tMatch[1]
      }
      sharedStrings.push(text)
    }
  }

  // 解析工作表
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles || sheetFiles.length === 0) {
    return ''
  }

  const lines: string[] = []

  for (const sheetFile of sheetFiles) {
    const sheetXml = sheetFile.asText()
    const sheetLines = extractSheetText(sheetXml, sharedStrings)
    if (sheetLines.length > 0) {
      lines.push(...sheetLines)
    }
  }

  return lines.join('\n')
}

/**
 * 从单个工作表 XML 中提取文本
 * 按行组织，每行内按列顺序拼接单元格内容
 */
function extractSheetText(sheetXml: string, sharedStrings: string[]): string[] {
  const lines: string[] = []

  // 提取所有单元格
  const cellRegex = /<c\s+r="([A-Z]+)(\d+)"([^>]*)>(?:<v>([^<]*)<\/v>)?/g
  let match

  // 按行分组
  const rowMap = new Map<number, { col: number; text: string }[]>()

  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const colLetter = match[1]
    const rowNum = parseInt(match[2], 10)
    const attrs = match[3]
    const rawValue = match[4] || ''

    // 解析列字母为数字
    let colNum = 0
    for (let i = 0; i < colLetter.length; i++) {
      colNum = colNum * 26 + (colLetter.charCodeAt(i) - 64)
    }

    // 获取单元格文本
    let cellText = ''
    const typeMatch = attrs.match(/t="([^"]+)"/)
    const type = typeMatch ? typeMatch[1] : 'n'

    if (type === 's') {
      // shared string
      const idx = parseInt(rawValue, 10)
      if (idx < sharedStrings.length) {
        cellText = sharedStrings[idx]
      }
    } else if (type === 'inlineStr') {
      // inline string - 从 XML 中提取
      cellText = rawValue
    } else {
      cellText = rawValue
    }

    if (cellText) {
      if (!rowMap.has(rowNum)) {
        rowMap.set(rowNum, [])
      }
      rowMap.get(rowNum)!.push({ col: colNum, text: cellText })
    }
  }

  // 按行号排序输出
  const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0])
  for (const [rowNum, cells] of sortedRows) {
    cells.sort((a, b) => a.col - b.col)
    const rowText = cells.map(c => c.text).join(' | ')
    if (rowText.trim()) {
      lines.push(`第${rowNum}行: ${rowText}`)
    }
  }

  return lines
}
