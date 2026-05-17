// 英英释义查询：Free Dictionary API + localStorage 缓存。
// 文档：https://dictionaryapi.dev/
//
// - 命中缓存直接返回，不发请求
// - 404 缓存为 "not-found"，避免反复查不存在的词
// - 网络错误抛异常（不缓存，留作下次重试）

export interface DictEntry {
  word: string;
  phonetic?: string;
  pos?: string; // part of speech, e.g. noun / verb
  def: string; // 第一条释义，已截断
}

export type DictResult = DictEntry | 'not-found';

const STORAGE_KEY = 'dict-cache-v1';
const MAX_DEF_CHARS = 120;
const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// 缓存按需懒读，避免 SSR / 受限环境出错。
let cache: Record<string, DictResult> | null = null;
function getCache(): Record<string, DictResult> {
  if (cache) return cache;
  cache = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) cache = JSON.parse(raw) as Record<string, DictResult>;
  } catch {
    cache = {};
  }
  return cache;
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getCache()));
  } catch {
    // 配额满或被禁用，忽略
  }
}

export function getCachedDefinition(word: string): DictResult | undefined {
  return getCache()[word.toLowerCase()];
}

interface RawDefinition {
  definition?: string;
}
interface RawMeaning {
  partOfSpeech?: string;
  definitions?: RawDefinition[];
}
interface RawPhonetic {
  text?: string;
}
interface RawEntry {
  word?: string;
  phonetic?: string;
  phonetics?: RawPhonetic[];
  meanings?: RawMeaning[];
}

function pickFirstDef(entry: RawEntry): {
  pos?: string;
  def?: string;
} {
  const meanings = entry.meanings ?? [];
  for (const m of meanings) {
    const defs = m.definitions ?? [];
    for (const d of defs) {
      if (d?.definition && d.definition.trim().length > 0) {
        return { pos: m.partOfSpeech, def: d.definition.trim() };
      }
    }
  }
  return {};
}

export async function lookupWord(word: string): Promise<DictResult> {
  const key = word.toLowerCase();
  if (!/^[a-z]+(?:['’][a-z]+)?$/i.test(key)) return 'not-found';

  const c = getCache();
  const cached = c[key];
  if (cached !== undefined) return cached;

  const url = API + encodeURIComponent(key);
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404) {
    c[key] = 'not-found';
    persist();
    return 'not-found';
  }
  if (!res.ok) {
    throw new Error(`词典查询失败 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as RawEntry[] | RawEntry;
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) {
    c[key] = 'not-found';
    persist();
    return 'not-found';
  }
  const entry = arr[0] ?? {};
  const { pos, def } = pickFirstDef(entry);
  if (!def) {
    c[key] = 'not-found';
    persist();
    return 'not-found';
  }
  const phonetic =
    entry.phonetic ?? entry.phonetics?.find((p) => p?.text)?.text;
  const trimmed =
    def.length > MAX_DEF_CHARS ? def.slice(0, MAX_DEF_CHARS).trim() + '…' : def;
  const result: DictEntry = {
    word: entry.word ?? key,
    phonetic: phonetic && phonetic.length > 0 ? phonetic : undefined,
    pos,
    def: trimmed,
  };
  c[key] = result;
  persist();
  return result;
}

export function clearDictionaryCache(): void {
  cache = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
