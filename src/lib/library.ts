// 文档库（学习记录）。
// 用 IndexedDB 持久化文档元数据 + 已提取文本 + 阅读进度 + 释义记录。
// 不保存原始 PDF 或音频文件，避免占用大量空间——文本本身只有几十 KB。
//
// 主键：文档 SHA-256 hash（基于原始文件字节）
// 通过 hash 去重：再次上传同一份文档会直接打开旧条目。
//
// V2 起新增 vocab_mastery store：跨文档全局词汇掌握状态。
// V3 起新增 groups store：文档分组。

import type { DictEntry, DictResult } from './dict';

export interface LibraryEntry {
  hash: string;
  name: string; // 文件名（仅用于显示，可由用户重命名）
  size: number; // 原始文件字节数
  text: string; // 提取后的纯文本，进入阅读时由 splitParagraphs 重新切段
  createdAt: number; // 第一次上传时间
  lastReadAt: number; // 上次打开时间
  lastPositionSec: number; // 上次播放停留位置
  furthestPositionSec: number; // 历史最远位置
  audioDurationSec: number; // 上次配的音频时长（用来算进度百分比）
  totalListenSec: number; // 累计实际播放时长
  finished: boolean; // 是否读完（furthest / duration ≥ 0.95）
  annotations: Record<string, DictResult>; // 已查释义（不含 'loading' 临时状态）
  groupId?: string; // 所属分组 id，缺省 = 未分组（与"全部"一同显示）
}

export interface GroupRecord {
  id: string; // 短随机 id
  name: string;
  createdAt: number;
  order: number; // 自定义排序
}

export interface VocabMasteryRecord {
  word: string; // 小写，作为主键
  masteredAt: number; // 标为已掌握的时间
}

export interface VocabItem {
  word: string;
  result: DictEntry; // 仅含查到释义的词，'not-found' 不进入词汇表
  sources: string[]; // 出自哪些文档名（去重）
  mastered: boolean;
  masteredAt?: number;
}

const DB_NAME = 'audio-text-sync';
const STORE = 'library';
const VOCAB_STORE = 'vocab_mastery';
const GROUP_STORE = 'groups';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains(VOCAB_STORE)) {
        db.createObjectStore(VOCAB_STORE, { keyPath: 'word' });
      }
      if (!db.objectStoreNames.contains(GROUP_STORE)) {
        db.createObjectStore(GROUP_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function listEntries(): Promise<LibraryEntry[]> {
  const db = await openDB();
  const list =
    (await idbRequest(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<LibraryEntry[]>,
    )) ?? [];
  list.sort((a, b) => b.lastReadAt - a.lastReadAt);
  return list;
}

export async function getEntry(hash: string): Promise<LibraryEntry | undefined> {
  const db = await openDB();
  return idbRequest(
    db
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .get(hash) as IDBRequest<LibraryEntry | undefined>,
  );
}

export async function putEntry(entry: LibraryEntry): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(entry);
  await idbTx(tx);
}

export async function deleteEntry(hash: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(hash);
  await idbTx(tx);
}

export function makeNewEntry(p: {
  hash: string;
  name: string;
  size: number;
  text: string;
}): LibraryEntry {
  const now = Date.now();
  return {
    hash: p.hash,
    name: p.name,
    size: p.size,
    text: p.text,
    createdAt: now,
    lastReadAt: now,
    lastPositionSec: 0,
    furthestPositionSec: 0,
    audioDurationSec: 0,
    totalListenSec: 0,
    finished: false,
    annotations: {},
  };
}

export function progressOf(entry: LibraryEntry): number {
  if (entry.audioDurationSec <= 0) return 0;
  return Math.max(
    0,
    Math.min(1, entry.furthestPositionSec / entry.audioDurationSec),
  );
}

// ============== 分组 / 重命名 ==============

function shortId(): string {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-3)
  );
}

export async function listGroups(): Promise<GroupRecord[]> {
  const db = await openDB();
  const list =
    (await idbRequest(
      db
        .transaction(GROUP_STORE, 'readonly')
        .objectStore(GROUP_STORE)
        .getAll() as IDBRequest<GroupRecord[]>,
    )) ?? [];
  list.sort(
    (a, b) => a.order - b.order || a.createdAt - b.createdAt,
  );
  return list;
}

export async function createGroup(name: string): Promise<GroupRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分组名不能为空');
  const existing = await listGroups();
  const maxOrder = existing.reduce((m, g) => Math.max(m, g.order), -1);
  const rec: GroupRecord = {
    id: shortId(),
    name: trimmed,
    createdAt: Date.now(),
    order: maxOrder + 1,
  };
  const db = await openDB();
  const tx = db.transaction(GROUP_STORE, 'readwrite');
  tx.objectStore(GROUP_STORE).put(rec);
  await idbTx(tx);
  return rec;
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分组名不能为空');
  const db = await openDB();
  const tx = db.transaction(GROUP_STORE, 'readwrite');
  const store = tx.objectStore(GROUP_STORE);
  const cur = await idbRequest(
    store.get(id) as IDBRequest<GroupRecord | undefined>,
  );
  if (!cur) {
    await idbTx(tx);
    return;
  }
  store.put({ ...cur, name: trimmed });
  await idbTx(tx);
}

// 删除分组：
// - mode='release'  → 仅删除分组，里面的文档 groupId 置 undefined（落到"全部"）
// - mode='cascade'  → 把分组下所有文档也一并删除
export async function deleteGroup(
  id: string,
  mode: 'release' | 'cascade',
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE, GROUP_STORE], 'readwrite');
  const lib = tx.objectStore(STORE);
  const grp = tx.objectStore(GROUP_STORE);
  const all =
    (await idbRequest(lib.getAll() as IDBRequest<LibraryEntry[]>)) ?? [];
  for (const entry of all) {
    if (entry.groupId !== id) continue;
    if (mode === 'cascade') {
      lib.delete(entry.hash);
    } else {
      const next: LibraryEntry = { ...entry };
      delete next.groupId;
      lib.put(next);
    }
  }
  grp.delete(id);
  await idbTx(tx);
}

export async function moveEntryToGroup(
  hash: string,
  groupId: string | undefined,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const entry = await idbRequest(
    store.get(hash) as IDBRequest<LibraryEntry | undefined>,
  );
  if (!entry) {
    await idbTx(tx);
    return;
  }
  const next: LibraryEntry = { ...entry };
  if (groupId) next.groupId = groupId;
  else delete next.groupId;
  store.put(next);
  await idbTx(tx);
}

export async function renameEntry(
  hash: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('文件名不能为空');
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const entry = await idbRequest(
    store.get(hash) as IDBRequest<LibraryEntry | undefined>,
  );
  if (!entry) {
    await idbTx(tx);
    return;
  }
  store.put({ ...entry, name: trimmed });
  await idbTx(tx);
}

// ============== 词汇掌握状态 ==============

export async function listMastery(): Promise<Map<string, VocabMasteryRecord>> {
  const db = await openDB();
  const list =
    (await idbRequest(
      db
        .transaction(VOCAB_STORE, 'readonly')
        .objectStore(VOCAB_STORE)
        .getAll() as IDBRequest<VocabMasteryRecord[]>,
    )) ?? [];
  const m = new Map<string, VocabMasteryRecord>();
  for (const r of list) m.set(r.word, r);
  return m;
}

export async function setMastered(word: string, mastered: boolean): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(VOCAB_STORE, 'readwrite');
  const key = word.toLowerCase();
  if (mastered) {
    tx.objectStore(VOCAB_STORE).put({ word: key, masteredAt: Date.now() });
  } else {
    tx.objectStore(VOCAB_STORE).delete(key);
  }
  await idbTx(tx);
}

export async function clearAllMastery(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(VOCAB_STORE, 'readwrite');
  tx.objectStore(VOCAB_STORE).clear();
  await idbTx(tx);
}

// 把所有文档里查过的英文释义聚合成一份全局词汇表。
// - 'not-found' 词被丢弃（没东西可复习）
// - 同一个词出现在多个文档里，sources 合并去重
export async function listVocab(): Promise<VocabItem[]> {
  const [entries, mastery] = await Promise.all([
    listEntries(),
    listMastery(),
  ]);
  const map = new Map<string, VocabItem>();
  for (const e of entries) {
    const ann = e.annotations || {};
    for (const [w, r] of Object.entries(ann)) {
      if (r === 'not-found') continue;
      const key = w.toLowerCase();
      const m = mastery.get(key);
      const exist = map.get(key);
      if (exist) {
        if (!exist.sources.includes(e.name)) exist.sources.push(e.name);
      } else {
        map.set(key, {
          word: key,
          result: r,
          sources: [e.name],
          mastered: !!m,
          masteredAt: m?.masteredAt,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.word.localeCompare(b.word));
}

export function relativeDate(ts: number): string {
  const d = Date.now() - ts;
  const day = 24 * 3600_000;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < day) return `${Math.floor(d / 3600_000)} 小时前`;
  if (d < 2 * day) return '昨天';
  if (d < 7 * day) return `${Math.floor(d / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
