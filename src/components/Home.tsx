import { useEffect, useState } from 'react';
import {
  computeFileHash,
  deleteEntry,
  getEntry,
  listEntries,
  makeNewEntry,
  progressOf,
  putEntry,
  relativeDate,
  type LibraryEntry,
} from '../lib/library';
import { extractDocxText } from '../lib/docxParse';
import { extractPdfText, type PdfParseProgress } from '../lib/pdfParse';
import {
  IconCheck,
  IconDoc,
  IconNotebook,
  IconPlus,
  IconShelf,
  IconTrash,
} from './Icons';
import Vocab from './Vocab';

interface Props {
  onOpen: (entry: LibraryEntry) => void;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '—';
  const s = Math.floor(t);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

type Tab = 'docs' | 'vocab';

export default function Home({ onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('docs');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<PdfParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setEntries(await listEntries());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleUpload(file: File) {
    setParsing(true);
    setError(null);
    setProgress(null);
    try {
      const hash = await computeFileHash(file);
      let entry = await getEntry(hash);
      if (!entry) {
        const isPdf =
          file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const isDocx =
          /\.docx$/i.test(file.name) ||
          file.type ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const isDoc = /\.doc$/i.test(file.name) && !isDocx;
        let text: string;
        if (isPdf) {
          text = await extractPdfText(file, setProgress);
        } else if (isDocx || isDoc) {
          text = await extractDocxText(file);
        } else {
          text = await file.text();
        }
        if (!text.trim()) {
          throw new Error('未能从文档中提取到任何文字。');
        }
        entry = makeNewEntry({
          hash,
          name: file.name,
          size: file.size,
          text,
        });
        await putEntry(entry);
      } else {
        entry = { ...entry, lastReadAt: Date.now() };
        await putEntry(entry);
      }
      onOpen(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
      setProgress(null);
    }
  }

  async function handleDelete(hash: string, name: string) {
    if (!confirm(`确定删除《${name}》？\n阅读进度和已查释义都会一起消失。`)) {
      return;
    }
    try {
      await deleteEntry(hash);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="app home">
      <header className="app-header">
        <h1>同读</h1>
        <span className="meta">
          {tab === 'docs'
            ? loading
              ? '…'
              : `${entries.length} 篇`
            : '词汇表'}
        </span>
      </header>

      <div className="tabbar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'docs'}
          className={`tab ${tab === 'docs' ? 'active' : ''}`}
          onClick={() => setTab('docs')}
        >
          <IconShelf size={16} />
          书架
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'vocab'}
          className={`tab ${tab === 'vocab' ? 'active' : ''}`}
          onClick={() => setTab('vocab')}
        >
          <IconNotebook size={16} />
          单词
        </button>
      </div>

      <main className="home-main">
        {tab === 'vocab' ? (
          <Vocab />
        ) : (
          <DocsPane
            loading={loading}
            entries={entries}
            parsing={parsing}
            progress={progress}
            error={error}
            onUpload={handleUpload}
            onDelete={handleDelete}
            onOpen={onOpen}
          />
        )}
      </main>
    </div>
  );
}

interface DocsPaneProps {
  loading: boolean;
  entries: LibraryEntry[];
  parsing: boolean;
  progress: PdfParseProgress | null;
  error: string | null;
  onUpload: (file: File) => void;
  onDelete: (hash: string, name: string) => void;
  onOpen: (entry: LibraryEntry) => void;
}

function DocsPane({
  loading,
  entries,
  parsing,
  progress,
  error,
  onUpload,
  onDelete,
  onOpen,
}: DocsPaneProps) {
  return (
    <>
      <label className={`upload-card add-card ${parsing ? 'busy' : ''}`}>
          <input
            type="file"
            accept=".txt,.md,.pdf,.docx,.doc,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            onChange={(e) =>
              e.target.files && onUpload(e.target.files[0])
            }
            disabled={parsing}
          />
          <span className="icon" aria-hidden>
            <IconPlus size={22} />
          </span>
          <span className="text">
            <span className="t">添加文档</span>
            <span className="s">PDF / DOCX / TXT / Markdown</span>
          </span>
        </label>

        {parsing && (
          <div className="progress">
            <div>
              {progress
                ? `解析 PDF 第 ${progress.page} / ${progress.totalPages} 页`
                : '解析文档…'}
            </div>
            {progress && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${((progress.page / progress.totalPages) * 100).toFixed(1)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {!loading && entries.length === 0 && !parsing && (
          <div className="empty-hint">
            这里会保留你阅读过的文档、阅读进度，以及在文中查过的英文释义。
          </div>
        )}

        <ul className="entries">
          {entries.map((entry) => {
            const pct = Math.round(progressOf(entry) * 100);
            const annCount = Object.keys(entry.annotations ?? {}).length;
            return (
              <li
                key={entry.hash}
                className={`entry-card ${entry.finished ? 'done' : ''}`}
                onClick={() => onOpen(entry)}
              >
                <div className="entry-head">
                  <span className="entry-icon" aria-hidden>
                    <IconDoc size={18} />
                  </span>
                  <div className="entry-name" title={entry.name}>
                    {entry.name}
                  </div>
                  {entry.finished && (
                    <span className="entry-badge">
                      <IconCheck size={12} />
                      读完
                    </span>
                  )}
                  <button
                    type="button"
                    className="entry-del"
                    aria-label="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(entry.hash, entry.name);
                    }}
                  >
                    <IconTrash size={16} />
                  </button>
                </div>

                <div className="entry-progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="entry-meta">
                  <span>{relativeDate(entry.lastReadAt)}</span>
                  <span className="dot">·</span>
                  <span>{pct}%</span>
                  {entry.audioDurationSec > 0 && (
                    <>
                      <span className="dot">·</span>
                      <span className="mono">
                        {fmtTime(entry.lastPositionSec)} /{' '}
                        {fmtTime(entry.audioDurationSec)}
                      </span>
                    </>
                  )}
                  {annCount > 0 && (
                    <>
                      <span className="dot">·</span>
                      <span>{annCount} 词</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
    </>
  );
}
