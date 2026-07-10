import PizZip from 'pizzip'
import type { FormField } from '../agents/formFiller'

/**
 * Excel 填写方法类型
 */
export type ExcelFillMethod = 'excel-com' | 'xml-direct'

/**
 * 单元格位置信息
 */
interface CellInfo {
  ref: string // 如 "A1", "B2"
  value: string
  type: 's' | 'str' | 'n' | 'b' | 'inlineStr' // shared string, string, number, boolean, inline string
}

/**
 * 从 Excel XML 中提取单元格信息
 */
function extractCellsFromSheet(sheetXml: string): CellInfo[] {
  const cells: CellInfo[] = []
  const cellRegex = /<c\s+r="([^"]+)"([^>]*)>(?:<v>([^<]*)<\/v>)?/g
  let match

  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const ref = match[1]
    const attrs = match[2]
    const value = match[3] || ''

    // 提取类型属性
    const typeMatch = attrs.match(/t="([^"]+)"/)
    const type = typeMatch ? typeMatch[1] as CellInfo['type'] : 'n'

    cells.push({ ref, value, type })
  }

  return cells
}

/**
 * 解析 sharedStrings.xml 获取字符串映射
 */
function parseSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = []
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let match

  while ((match = siRegex.exec(sharedStringsXml)) !== null) {
    const siContent = match[1]
    // 提取所有 <t> 标签的内容
    const tRegex = /<t[^>]*>([^<]*)<\/t>/g
    let text = ''
    let tMatch

    while ((tMatch = tRegex.exec(siContent)) !== null) {
      text += tMatch[1]
    }

    strings.push(text)
  }

  return strings
}

/**
 * 将列字母转换为数字（A=1, B=2, ..., Z=26, AA=27, ...）
 */
function columnLetterToNumber(letter: string): number {
  let num = 0
  for (let i = 0; i < letter.length; i++) {
    num = num * 26 + (letter.charCodeAt(i) - 64)
  }
  return num
}

/**
 * 将数字转换为列字母（1=A, 2=B, ..., 26=Z, 27=AA, ...）
 */
function columnNumberToLetter(num: number): string {
  let letter = ''
  while (num > 0) {
    const remainder = (num - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    num = Math.floor((num - 1) / 26)
  }
  return letter
}

/**
 * 解析单元格引用（如 "A1"）为列号和行号
 */
function parseCellRef(ref: string): { col: number; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`Invalid cell reference: ${ref}`)

  const col = columnLetterToNumber(match[1])
  const row = parseInt(match[2], 10)

  return { col, row }
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 使用 XML 直接操作填写 Excel 文件
 * 通过修改 sharedStrings.xml 和 sheet XML 实现
 */
export async function fillXlsxWithXml(
  rawContent: ArrayBuffer | string,
  fields: FormField[]
): Promise<string> {
  let buffer: Uint8Array
  if (typeof rawContent === 'string') {
    const binaryString = atob(rawContent)
    buffer = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i)
    }
  } else {
    buffer = new Uint8Array(rawContent)
  }

  const zip = new PizZip(buffer)

  // 读取 sharedStrings.xml
  const sharedStringsEntry = zip.file('xl/sharedStrings.xml')
  const sharedStrings = sharedStringsEntry ? parseSharedStrings(sharedStringsEntry.asText()) : []

  // 读取工作簿以获取工作表映射
  const workbookEntry = zip.file('xl/workbook.xml')
  if (!workbookEntry) {
    throw new Error('无法读取 workbook.xml')
  }

  // 查找所有工作表文件
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles || sheetFiles.length === 0) {
    throw new Error('无法找到工作表文件')
  }

  console.log(`[xlsxHandler][XML] Found ${sheetFiles.length} sheet(s)`)

  // 构建字段映射：label -> value
  const fieldMap = new Map<string, string>()
  for (const field of fields) {
    if (field.value) {
      fieldMap.set(field.label, field.value)
    }
  }

  // 处理每个工作表
  for (const sheetFile of sheetFiles) {
    let sheetXml = sheetFile.asText()
    const cells = extractCellsFromSheet(sheetXml)

    console.log(`[xlsxHandler][XML] Processing sheet: ${sheetFile.name}, found ${cells.length} cells`)

    // 查找标签单元格并填写值
    for (const cell of cells) {
      // 获取单元格文本
      let cellText = ''
      if (cell.type === 's') {
        // shared string
        const idx = parseInt(cell.value, 10)
        if (idx < sharedStrings.length) {
          cellText = sharedStrings[idx]
        }
      } else if (cell.type === 'inlineStr') {
        // inline string - 需要从 XML 中提取
        const inlineMatch = sheetXml.match(new RegExp(`<c[^>]*r="${cell.ref}"[^>]*>.*?<t[^>]*>([^<]*)<\/t>.*?<\\/c>`, 's'))
        if (inlineMatch) {
          cellText = inlineMatch[1]
        }
      } else {
        cellText = cell.value
      }

      // 检查是否是标签
      const value = fieldMap.get(cellText)
      if (value !== undefined) {
        console.log(`[xlsxHandler][XML] Found label "${cellText}" at ${cell.ref}, filling with "${value}"`)

        // 填写右侧单元格
        let targetRef: string
        try {
          const { col, row } = parseCellRef(cell.ref)
          const targetCol = col + 1
          targetRef = `${columnNumberToLetter(targetCol)}${row}`
        } catch (parseErr) {
          console.warn(`[xlsxHandler][XML] Invalid cell reference: ${cell.ref}, skipping`)
          continue
        }

        // 添加新字符串到 sharedStrings
        const newIdx = sharedStrings.length
        sharedStrings.push(value)

        // 修改工作表 XML，在目标单元格写入值
        const targetCellRegex = new RegExp(`<c\\s+r="${targetRef}"[^>]*>.*?<\\/c>`, 's')
        if (targetCellRegex.test(sheetXml)) {
          // 单元格已存在，更新它
          sheetXml = sheetXml.replace(
            targetCellRegex,
            `<c r="${targetRef}" t="s"><v>${newIdx}</v></c>`
          )
        } else {
          // 单元格不存在，在合适位置插入
          // 简单策略：在 </sheetData> 前插入
          sheetXml = sheetXml.replace(
            '</sheetData>',
            `<c r="${targetRef}" t="s"><v>${newIdx}</v></c></sheetData>`
          )
        }

        console.log(`[xlsxHandler][XML] ✓ Filled ${targetRef} with "${value}"`)
      }
    }

    // 更新工作表 XML
    zip.file(sheetFile.name, sheetXml)
  }

  // 更新 sharedStrings.xml
  if (sharedStringsEntry) {
    let newSharedStringsXml = sharedStringsEntry.asText()

    // 重建 sharedStrings 内容
    const siEntries = sharedStrings.map(s => `<si><t>${escapeXml(s)}</t></si>`).join('')
    newSharedStringsXml = newSharedStringsXml.replace(
      /<sst([^>]*)>[\s\S]*<\/sst>/,
      `<sst$1>${siEntries}</sst>`
    )

    // 更新 count 和 uniqueCount 属性
    // uniqueCount: 不重复字符串的数量
    // count: 所有单元格对共享字符串的总引用次数
    const uniqueCount = sharedStrings.length
    
    // 统计实际的引用次数：遍历所有工作表，统计 type='s' 的单元格数量
    let totalCount = 0
    for (const sheetFile of sheetFiles) {
      const sheetXml = zip.file(sheetFile.name)?.asText() || ''
      const cells = extractCellsFromSheet(sheetXml)
      totalCount += cells.filter(c => c.type === 's').length
    }
    
    newSharedStringsXml = newSharedStringsXml.replace(
      /uniqueCount="\d+"/,
      `uniqueCount="${uniqueCount}"`
    )
    newSharedStringsXml = newSharedStringsXml.replace(
      /count="\d+"/,
      `count="${totalCount}"`
    )

    zip.file('xl/sharedStrings.xml', newSharedStringsXml)
  }

  // 创建全新的 zip 实例，逐个复制文件（避免直接修改原实例导致文件损坏）
  const newZip = new PizZip()
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      newZip.file(zipEntry.name, zipEntry.asBinary())
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  console.log(`[xlsxHandler][XML] Generated blob, size: ${blob.length} bytes`)

  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}

/**
 * 使用 Excel COM 自动化填写 .xlsx 文件
 * 通过 PowerShell 调用 Excel.Application COM 对象
 */
export async function fillXlsxWithExcelCOM(
  filePath: string,
  fields: FormField[],
  execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  readFile: (path: string) => Promise<{ content: ArrayBuffer | null; error: string | null; size: number }>
): Promise<string> {
  const fieldsWithValue = fields.filter(f => f.value)
  console.log(`[xlsxHandler][ExcelCOM] Filling ${fieldsWithValue.length} fields via Excel COM`)

  // 构建 PowerShell 脚本
  const psCommands: string[] = []

  // 复制原文件为新文件
  const newFilePath = filePath.replace(/\.([^.]+)$/, '_filled.$1')
  psCommands.push(`Copy-Item -LiteralPath '${escapePsString(filePath)}' -Destination '${escapePsString(newFilePath)}' -Force`)

  // 创建 Excel COM 对象
  psCommands.push('$excel = New-Object -ComObject Excel.Application')
  psCommands.push('$excel.Visible = $false')
  psCommands.push('$excel.DisplayAlerts = $false')

  // 打开工作簿
  psCommands.push(`$workbook = $excel.Workbooks.Open('${escapePsString(newFilePath)}')`)

  // 对每个字段，只在第一个工作表中查找并填写（避免多工作表重复修改）
  psCommands.push('$sheet = $workbook.Sheets.Item(1)')
  psCommands.push('$usedRange = $sheet.UsedRange')

  for (const field of fieldsWithValue) {
    const label = field.label
    const value = field.value

    console.log(`[xlsxHandler][ExcelCOM] Processing field: "${label}" = "${value}"`)

    psCommands.push(`
# 查找标签 "${label}"
$found = $usedRange.Find('${escapePsString(label)}')
if ($found) {
  # 在右侧单元格填写值
  $targetCell = $found.Offset(0, 1)
  $targetCell.Value2 = '${escapePsString(value)}'
  Write-Host "Filled: ${escapePsString(label)} = ${escapePsString(value)} at $($found.Address)"
} else {
  Write-Host "Not found: ${escapePsString(label)}"
}
`)
  }

  // 保存并关闭
  psCommands.push('$workbook.Save()')
  psCommands.push('$workbook.Close()')
  psCommands.push('$excel.Quit()')
  psCommands.push('[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null')
  psCommands.push(`Write-Host "DONE:${newFilePath}"`)

  const fullScript = psCommands.join('\n')

  // 使用 EncodedCommand 避免引号转义问题（PowerShell 需要 UTF-16LE 编码）
  const utf16Bytes = new Uint8Array(fullScript.length * 2)
  for (let i = 0; i < fullScript.length; i++) {
    const code = fullScript.charCodeAt(i)
    utf16Bytes[i * 2] = code & 0xff
    utf16Bytes[i * 2 + 1] = (code >> 8) & 0xff
  }
  let binary = ''
  for (let i = 0; i < utf16Bytes.length; i++) {
    binary += String.fromCharCode(utf16Bytes[i])
  }
  const scriptBase64 = btoa(binary)
  const psCommand = `powershell -ExecutionPolicy Bypass -EncodedCommand ${scriptBase64}`

  console.log('[xlsxHandler][ExcelCOM] Executing PowerShell script...')
  const result = await execCommand(psCommand)

  console.log('[xlsxHandler][ExcelCOM] stdout:', result.stdout)
  if (result.stderr) {
    console.warn('[xlsxHandler][ExcelCOM] stderr:', result.stderr)
  }

  if (result.exitCode !== 0) {
    throw new Error(`Excel COM 填写失败 (exit code ${result.exitCode}): ${result.stderr}`)
  }

  // 读取生成的文件
  const { content, error } = await readFile(newFilePath)
  if (error || !content) {
    throw new Error(`无法读取填写后的文件: ${error}`)
  }

  const bytes = new Uint8Array(content)
  let resultBinary = ''
  for (let i = 0; i < bytes.length; i++) {
    resultBinary += String.fromCharCode(bytes[i])
  }
  return btoa(resultBinary)
}

function escapePsString(str: string): string {
  return str.replace(/'/g, "''")
}
