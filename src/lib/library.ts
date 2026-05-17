// 文档库（学习记录）。
// 用 IndexedDB 持久化文档元数据 + 已提取文本 + 阅读进度 + 释义记录。
// 不保存原始 PDF 或音频文件，避免占用大量空间——文本本身只有几十 KB。
//
// 主键：文档 SHA-256 hash（基于原始文件字节）
// 通过 hash 去重：再次上传同一份文档会直接打开旧条目。

import type { DictResult } from './dict';

export interface LibraryEntry {
  hash: string;
  name: string; // 文件名（仅用于显示）
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
}

const DB_NAME = 'audio-text-sync';
const STORE = 'library';
const DB_VERSION = 1;

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
