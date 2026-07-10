/**
 * MemoryStore — 基于 PlatformStorage 的持久化记忆存储
 * 容量上限 500 条，写入去抖 500ms，支持按多维度查询
 */

import type { PlatformAPI } from '../api/platformAPI'
import type { MemoryEntry, MemoryQuery, MemoryStats, MemoryCategory } from './types'

const STORAGE_KEY = 'agent_memory'
const MAX_ENTRIES = 500
const DEBOUNCE_MS = 500

export class MemoryStore {
  private platform: PlatformAPI
  private entries: MemoryEntry[] = []
  private dirty = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(platform: PlatformAPI) {
    this.platform = platform
  }

  /** 从持久化存储加载记忆 */
  async init(): Promise<void> {
    try {
      const raw = await this.platform.storage.getData(STORAGE_KEY)
      if (raw) {
        this.entries = JSON.parse(raw)
        // 清理过期记忆
        const now = Date.now()
        this.entries = this.entries.filter((e) => !e.expiresAt || e.expiresAt > now)
      }
    } catch {
      this.entries = []
    }
    this.initialized = true
  }

  /** 查询记忆 */
  query(q: MemoryQuery = {}): MemoryEntry[] {
    let result = [...this.entries]

    if (q.text) {
      const lower = q.text.toLowerCase()
      result = result.filter(
        (e) =>
          e.content.toLowerCase().includes(lower) ||
          e.key.toLowerCase().includes(lower) ||
          e.tags.some((t) => t.toLowerCase().includes(lower))
      )
    }

    if (q.category) {
      result = result.filter((e) => e.category === q.category)
    }

    if (q.tag) {
      const lowerTag = q.tag.toLowerCase()
      result = result.filter((e) => e.tags.some((t) => t.toLowerCase() === lowerTag))
    }

    if (q.projectPath) {
      result = result.filter((e) => e.projectPath === q.projectPath)
    }

    // 按更新时间倒序
    result.sort((a, b) => b.updatedAt - a.updatedAt)

    const offset = q.offset || 0
    const limit = q.limit || 50
    return result.slice(offset, offset + limit)
  }

  /** 添加或更新记忆（按 key 去重） */
  upsert(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry {
    const now = Date.now()
    const existing = this.entries.find((e) => e.key === entry.key)

    if (existing) {
      existing.content = entry.content
      existing.tags = entry.tags
      existing.category = entry.category
      existing.projectPath = entry.projectPath
      existing.expiresAt = entry.expiresAt
      existing.updatedAt = now
      this.markDirty()
      return existing
    }

    const newEntry: MemoryEntry = {
      ...entry,
      id: `mem-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }

    this.entries.push(newEntry)

    // 容量上限：删除最旧的
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => a.updatedAt - b.updatedAt)
      this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    }

    this.markDirty()
    return newEntry
  }

  /** 删除记忆 */
  delete(idOrKey: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === idOrKey || e.key === idOrKey)
    if (idx === -1) return false
    this.entries.splice(idx, 1)
    this.markDirty()
    return true
  }

  /** 获取统计信息 */
  getStats(): MemoryStats {
    const byCategory: Record<string, number> = {}
    for (const e of this.entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1
    }

    let oldest: number | null = null
    let newest: number | null = null
    if (this.entries.length > 0) {
      oldest = this.entries[0].createdAt
      newest = this.entries[0].updatedAt
      for (const e of this.entries) {
        if (e.createdAt < (oldest ?? Infinity)) oldest = e.createdAt
        if (e.updatedAt > (newest ?? -Infinity)) newest = e.updatedAt
      }
    }

    return {
      total: this.entries.length,
      byCategory,
      oldestEntry: oldest,
      newestEntry: newest,
    }
  }

  /** 获取所有条目（调试用） */
  getAll(): MemoryEntry[] {
    return [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 强制刷新到存储 */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.dirty) {
      await this.persist()
    }
  }

  // ========== 内部 ==========

  private markDirty(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.persist(), DEBOUNCE_MS)
  }

  private async persist(): Promise<void> {
    const entriesSnapshot = this.entries
    this.dirty = false
    try {
      await this.platform.storage.setData(STORAGE_KEY, JSON.stringify(entriesSnapshot))
    } catch {
      // 存储失败，恢复 dirty 标志以便下次重试
      this.dirty = true
    }
  }
}
