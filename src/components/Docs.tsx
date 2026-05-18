import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeFileHash,
  createGroup,
  deleteEntry,
  deleteGroup,
  getEntry,
  listEntries,
  listGroups,
  makeNewEntry,
  moveEntryToGroup,
  progressOf,
  putEntry,
  relativeDate,
  renameEntry,
  renameGroup,
  type GroupRecord,
  type LibraryEntry,
} from '../lib/library';
import { extractDocxText } from '../lib/docxParse';
import { extractPdfText, type PdfParseProgress } from '../lib/pdfParse';
import {
  IconCheck,
  IconChevronDown,
  IconDoc,
  IconEdit,
  IconFolder,
  IconPlus,
  IconTrash,
} from './Icons';

interface Props {
  onOpen: (entry: LibraryEntry) => void;
  onCountChange?: (count: number) => void;
  onLoadingChange?: (loading: boolean) => void;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '—';
  const s = Math.floor(t);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const ALL = '__all__';

export default function Docs({
  onOpen,
  onCountChange,
  onLoadingChange,
}: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<PdfParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 当前展开的菜单：分组菜单（按 group id）或卡片菜单（按 entry hash）
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  const [openMoveMenu, setOpenMoveMenu] = useState<string | null>(null);
  const [editingHash, setEditingHash] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const rootRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const [es, gs] = await Promise.all([listEntries(), listGroups()]);
      setEntries(es);
      setGroups(gs);
      // 当前选中的分组若已被删，回到"全部"
      if (activeGroup !== ALL && !gs.some((g) => g.id === activeGroup)) {
        setActiveGroup(ALL);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    onCountChange?.(entries.length);
  }, [entries.length, onCountChange]);

  // 点空白处关闭打开的菜单
  useEffect(() => {
    if (openGroupMenu == null && openMoveMenu == null) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && rootRef.current?.contains(target)) {
        // 让按钮自身的 onClick 决定关不关
        if (target.closest('.group-chip-arrow')) return;
        if (target.closest('.entry-move-btn')) return;
        if (target.closest('.popover-menu')) return;
      }
      setOpenGroupMenu(null);
      setOpenMoveMenu(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openGroupMenu, openMoveMenu]);

  const visibleEntries = useMemo(() => {
    if (activeGroup === ALL) return entries;
    return entries.filter((e) => e.groupId === activeGroup);
  }, [entries, activeGroup]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (e.groupId) m.set(e.groupId, (m.get(e.groupId) ?? 0) + 1);
    }
    return m;
  }, [entries]);

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
        // 当前若选中了具体分组，则新文档默认归入此分组
        if (activeGroup !== ALL) {
          entry = { ...entry, groupId: activeGroup };
        }
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

  async function handleDeleteEntry(hash: string, name: string) {
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

  async function handleNewGroup() {
    const name = window.prompt('新建分组名称')?.trim();
    if (!name) return;
    try {
      const rec = await createGroup(name);
      await refresh();
      setActiveGroup(rec.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRenameGroup(g: GroupRecord) {
    setOpenGroupMenu(null);
    const next = window.prompt('重命名分组', g.name)?.trim();
    if (next == null) return;
    if (!next) {
      alert('分组名不能为空');
      return;
    }
    try {
      await renameGroup(g.id, next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleReleaseGroup(g: GroupRecord) {
    setOpenGroupMenu(null);
    const count = groupCounts.get(g.id) ?? 0;
    if (
      !confirm(
        count > 0
          ? `把分组「${g.name}」中的 ${count} 篇文档释放回「全部」，并删除该分组？`
          : `删除空分组「${g.name}」？`,
      )
    ) {
      return;
    }
    try {
      await deleteGroup(g.id, 'release');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCascadeDeleteGroup(g: GroupRecord) {
    setOpenGroupMenu(null);
    const count = groupCounts.get(g.id) ?? 0;
    if (count === 0) {
      // 没有文档，直接删除（与 release 行为相同）
      try {
        await deleteGroup(g.id, 'release');
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (
      !confirm(
        `连同分组「${g.name}」一起删除其中 ${count} 篇文档？\n阅读进度和已查释义会一并消失，且无法恢复。`,
      )
    ) {
      return;
    }
    try {
      await deleteGroup(g.id, 'cascade');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleMoveEntry(
    entry: LibraryEntry,
    groupId: string | undefined,
  ) {
    setOpenMoveMenu(null);
    if (entry.groupId === groupId) return;
    try {
      await moveEntryToGroup(entry.hash, groupId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startRename(entry: LibraryEntry) {
    setEditingHash(entry.hash);
    setEditingValue(entry.name);
  }

  async function commitRename() {
    if (!editingHash) return;
    const next = editingValue.trim();
    const origin = entries.find((e) => e.hash === editingHash);
    if (!origin) {
      setEditingHash(null);
      return;
    }
    if (!next) {
      // 校验：不允许空名，回退到原值
      setEditingHash(null);
      return;
    }
    if (next === origin.name) {
      setEditingHash(null);
      return;
    }
    try {
      await renameEntry(editingHash, next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditingHash(null);
    }
  }

  return (
    <div ref={rootRef}>
      <div className="group-bar">
        <button
          type="button"
          className={`group-chip ${activeGroup === ALL ? 'active' : ''}`}
          onClick={() => setActiveGroup(ALL)}
        >
          <span className="group-chip-name">全部</span>
          <span className="group-chip-count">{entries.length}</span>
        </button>
        {groups.map((g) => {
          const count = groupCounts.get(g.id) ?? 0;
          const active = activeGroup === g.id;
          return (
            <div
              key={g.id}
              className={`group-chip has-menu ${active ? 'active' : ''}`}
            >
              <button
                type="button"
                className="group-chip-body"
                onClick={() => setActiveGroup(g.id)}
              >
                <span className="group-chip-name">{g.name}</span>
                <span className="group-chip-count">{count}</span>
              </button>
              <button
                type="button"
                className="group-chip-arrow"
                aria-label="分组操作"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenGroupMenu((cur) => (cur === g.id ? null : g.id));
                  setOpenMoveMenu(null);
                }}
              >
                <IconChevronDown size={14} />
              </button>
              {openGroupMenu === g.id && (
                <div className="popover-menu group-menu" role="menu">
                  <button
                    type="button"
                    onClick={() => handleRenameGroup(g)}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReleaseGroup(g)}
                  >
                    释放分组
                    <span className="hint">保留文档</span>
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleCascadeDeleteGroup(g)}
                  >
                    删除分组及文档
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="group-chip add"
          aria-label="新建分组"
          onClick={handleNewGroup}
        >
          <IconPlus size={16} />
        </button>
      </div>

      <label className={`upload-card add-card ${parsing ? 'busy' : ''}`}>
        <input
          type="file"
          accept=".txt,.md,.pdf,.docx,.doc,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
          onChange={(e) =>
            e.target.files && handleUpload(e.target.files[0])
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

      {!loading && visibleEntries.length === 0 && !parsing && (
        <div className="empty-hint">
          {activeGroup === ALL
            ? '这里会保留你阅读过的文档、阅读进度，以及在文中查过的英文释义。'
            : '该分组还没有文档。点击上方"添加文档"，或在已有文档卡片上选择移动到这里。'}
        </div>
      )}

      <ul className="entries">
        {visibleEntries.map((entry) => {
          const pct = Math.round(progressOf(entry) * 100);
          const annCount = Object.keys(entry.annotations ?? {}).length;
          const isEditing = editingHash === entry.hash;
          return (
            <li
              key={entry.hash}
              className={`entry-card ${entry.finished ? 'done' : ''}`}
              onClick={() => {
                // 编辑或菜单展开时，点击卡片不再打开文档
                if (isEditing) return;
                if (openMoveMenu === entry.hash) return;
                onOpen(entry);
              }}
            >
              <div className="entry-head">
                <span className="entry-icon" aria-hidden>
                  <IconDoc size={18} />
                </span>
                {isEditing ? (
                  <input
                    className="entry-name-input"
                    value={editingValue}
                    autoFocus
                    onChange={(e) => setEditingValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingHash(null);
                      }
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <div className="entry-name" title={entry.name}>
                    {entry.name}
                  </div>
                )}
                {entry.finished && !isEditing && (
                  <span className="entry-badge">
                    <IconCheck size={12} />
                    读完
                  </span>
                )}
                <div className="entry-actions">
                  <button
                    type="button"
                    className="entry-action"
                    aria-label="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(entry);
                    }}
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    type="button"
                    className="entry-action entry-move-btn"
                    aria-label="移动到分组"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMoveMenu((cur) =>
                        cur === entry.hash ? null : entry.hash,
                      );
                      setOpenGroupMenu(null);
                    }}
                  >
                    <IconFolder size={16} />
                  </button>
                  <button
                    type="button"
                    className="entry-action danger"
                    aria-label="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEntry(entry.hash, entry.name);
                    }}
                  >
                    <IconTrash size={16} />
                  </button>
                  {openMoveMenu === entry.hash && (
                    <div
                      className="popover-menu move-menu"
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="menu-title">移动到</div>
                      <button
                        type="button"
                        className={!entry.groupId ? 'active' : ''}
                        onClick={() => handleMoveEntry(entry, undefined)}
                      >
                        未分组
                      </button>
                      {groups.map((g) => (
                        <button
                          type="button"
                          key={g.id}
                          className={
                            entry.groupId === g.id ? 'active' : ''
                          }
                          onClick={() => handleMoveEntry(entry, g.id)}
                        >
                          {g.name}
                        </button>
                      ))}
                      {groups.length === 0 && (
                        <div className="menu-empty">
                          还没有分组。先点上方加号新建一个吧。
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
    </div>
  );
}
