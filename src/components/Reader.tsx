import { useEffect, useMemo, useRef, useState } from 'react';
import {
  alignByLengthDistribution,
  type DocSegment,
} from '../lib/aligner';
import { lookupWord, type DictResult } from '../lib/dict';
import { putEntry, type LibraryEntry } from '../lib/library';
import { splitParagraphs } from '../lib/textNormalize';
import AnnotatedText, { type AnnotationState } from './AnnotatedText';
import {
  IconBack,
  IconClose,
  IconHeadphones,
  IconPin,
  IconPlay,
  IconRefresh,
} from './Icons';
import Player from './Player';

interface Props {
  initialEntry: LibraryEntry;
  onBack: () => void;
}

export default function Reader({ initialEntry, onBack }: Props) {
  const [entry, setEntry] = useState<LibraryEntry>(initialEntry);

  // 进入文档时，即使还没选音频，也用上次保存的 audioDurationSec
  // 把段落预先对齐，并把 currentTime 推到上次离开的位置，
  // 这样阅读视图能立刻显示上次的位置并自动滚到那里。
  useEffect(() => {
    if (
      initialEntry.audioDurationSec > 0 &&
      initialEntry.lastPositionSec > 0
    ) {
      setDuration(initialEntry.audioDurationSec);
      setCurrentTime(initialEntry.lastPositionSec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [segments, setSegments] = useState<DocSegment[]>(() =>
    splitParagraphs(initialEntry.text).map((t, i) => ({
      id: i,
      text: t,
      matched: false as const,
    })),
  );
  const [aligned, setAligned] = useState(false);
  const [loadingWords, setLoadingWords] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [anchorMode, setAnchorMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  // 用 ref 而非 state 来记录待恢复位置，避免读到被回写覆盖后的 0。
  const resumeTargetRef = useRef<number>(initialEntry.lastPositionSec);
  const resumedRef = useRef(false);

  const audioUrl = useMemo(
    () => (audioFile ? URL.createObjectURL(audioFile) : ''),
    [audioFile],
  );
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // 拿到音频时长就立刻按字数均匀分布做对齐。
  useEffect(() => {
    if (duration > 0 && segments.length > 0) {
      const out = alignByLengthDistribution(
        segments.map((s) => ({ id: s.id, text: s.text })),
        duration,
      );
      setSegments(out);
      setAligned(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // 尝试恢复到上次播放位置；onLoadedMetadata 与 onCanPlay 都会调用一次。
  function tryResume(a: HTMLAudioElement) {
    if (resumedRef.current) return;
    if (!Number.isFinite(a.duration) || a.duration <= 0) return;
    const target = resumeTargetRef.current;
    if (target > 1 && target < a.duration - 5) {
      a.currentTime = target;
      setCurrentTime(target);
    }
    resumedRef.current = true;
  }

  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    setDuration(a.duration);
    setEntry((prev) => ({ ...prev, audioDurationSec: a.duration }));
    tryResume(a);
  }

  // 累计实际播放秒数：仅在 playing 且 currentTime 自然推进时计入。
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let last = a.currentTime;
    let acc = 0;
    const tick = () => {
      const now = a.currentTime;
      const diff = now - last;
      last = now;
      if (!a.paused && diff > 0 && diff < 1.5) acc += diff;
      if (acc >= 5) {
        const add = acc;
        acc = 0;
        setEntry((prev) => ({
          ...prev,
          totalListenSec: prev.totalListenSec + add,
        }));
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 进度回写到 entry。
  // 关键：恢复完成前（resumedRef.current === false）不允许 timeupdate
  // 把 lastPositionSec 改写成 0，否则保存的进度会被瞬间覆盖丢失。
  useEffect(() => {
    if (!resumedRef.current) return;
    if (currentTime <= 0) return;
    setEntry((prev) => {
      const furthest = Math.max(prev.furthestPositionSec, currentTime);
      const dur = prev.audioDurationSec;
      const finished =
        prev.finished || (dur > 0 && furthest / dur >= 0.95);
      if (
        Math.abs(prev.lastPositionSec - currentTime) < 0.5 &&
        prev.furthestPositionSec === furthest &&
        prev.finished === finished
      ) {
        return prev;
      }
      return {
        ...prev,
        lastPositionSec: currentTime,
        furthestPositionSec: furthest,
        finished,
        lastReadAt: Date.now(),
      };
    });
  }, [currentTime]);

  // 持久化策略：用 ref 镜像最新 entry；每 2 秒节流落盘，
  // 卸载和页面隐藏时同步再写一次。
  // （早期版本的"防抖 600ms"在持续播放时被每次 timeupdate 抢先清掉，
  //   导致根本写不到 IDB。）
  const entryRef = useRef(entry);
  entryRef.current = entry;

  useEffect(() => {
    let lastSaved: LibraryEntry = entryRef.current;
    const tryFlush = () => {
      const cur = entryRef.current;
      if (cur === lastSaved) return;
      lastSaved = cur;
      putEntry(cur).catch((e) => {
        console.error('保存进度失败：', e);
      });
    };
    const intervalId = window.setInterval(tryFlush, 2000);

    const onVis = () => {
      if (document.hidden) tryFlush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', tryFlush);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', tryFlush);
      tryFlush();
    };
  }, []);

  // 当前活动段
  const activeId = useMemo(() => {
    for (const s of segments) {
      if (
        s.matched &&
        s.start !== undefined &&
        s.end !== undefined &&
        currentTime >= s.start &&
        currentTime <= s.end
      ) {
        return s.id;
      }
    }
    return null;
  }, [segments, currentTime]);

  useEffect(() => {
    if (activeId === null) return;
    const reader = readerRef.current;
    const el = document.getElementById(`seg-${activeId}`);
    if (!reader || !el) return;
    const elRect = el.getBoundingClientRect();
    const rdRect = reader.getBoundingClientRect();
    const target =
      reader.scrollTop +
      (elRect.top - rdRect.top) -
      reader.clientHeight / 2 +
      el.clientHeight / 2;
    reader.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeId]);

  function jumpTo(seg: DocSegment) {
    const a = audioRef.current;
    if (!a || seg.start === undefined) return;
    a.currentTime = seg.start;
    a.play().catch(() => undefined);
  }

  // 把"被点中的那一段"对齐到当前播放点 T：
  // - 前面所有段在 [0, T] 区间按字数重新均分
  // - 当前段及之后按字数均分 [T, duration]
  // 这样不会出现"前一段 end > T"导致 activeId 命中错位的问题。
  function reAnchor(seg: DocSegment) {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const T = a.currentTime;
    const dur = a.duration;
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === seg.id);
      if (idx < 0) return prev;

      const head = prev.slice(0, idx);
      const tail = prev.slice(idx);

      const headChars = head.reduce(
        (acc, s) => acc + Math.max(s.text.length, 1),
        0,
      );
      const tailChars = tail.reduce(
        (acc, s) => acc + Math.max(s.text.length, 1),
        0,
      );

      const headSpan = Math.max(T, 0);
      const tailSpan = Math.max(dur - T, 0.01);

      // 前段：均分 [0, T]
      let th = 0;
      const headOut = head.map((s) => {
        const len = Math.max(s.text.length, 1);
        const d = headChars > 0 ? (len / headChars) * headSpan : 0;
        const out = {
          ...s,
          start: th,
          end: th + d,
          matched: true as const,
        };
        th += d;
        return out;
      });

      // 当前段及之后：均分 [T, dur]
      let tt = T;
      const tailOut = tail.map((s) => {
        const len = Math.max(s.text.length, 1);
        const d = tailChars > 0 ? (len / tailChars) * tailSpan : 0;
        const out = {
          ...s,
          start: tt,
          end: tt + d,
          matched: true as const,
        };
        tt += d;
        return out;
      });

      return [...headOut, ...tailOut];
    });
  }

  // 段落点击：
  // - 锚定模式 → 该段重锚到当前播放点（保持在锚定模式，由用户手动退出）
  // - 默认：单击跳转音频，双击重锚（250ms 内）
  // 段落点击行为现在大幅简化：
  // - 锚定模式（顶栏图钉激活）→ 该段重锚到当前播放点
  // - 其他情况 → 不做任何事，让单词点击和文本选择正常工作
  // 跳转到该段播放由段落左侧的小播放按钮处理（onSegmentPlay）。
  function handleSegmentClick(seg: DocSegment) {
    if (anchorMode) {
      reAnchor(seg);
      return;
    }
  }
  function onSegmentPlay(seg: DocSegment, e: React.MouseEvent) {
    e.stopPropagation();
    jumpTo(seg);
  }

  async function handleWordClick(word: string) {
    const lc = word.toLowerCase();
    if (loadingWords.has(lc)) return;
    if (entry.annotations[lc] !== undefined) {
      setEntry((prev) => {
        const next = { ...prev.annotations };
        delete next[lc];
        return { ...prev, annotations: next };
      });
      return;
    }
    setLoadingWords((prev) => new Set(prev).add(lc));
    try {
      const r: DictResult = await lookupWord(word);
      setEntry((prev) => ({
        ...prev,
        annotations: { ...prev.annotations, [lc]: r },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingWords((prev) => {
        const next = new Set(prev);
        next.delete(lc);
        return next;
      });
    }
  }

  function clearAnnotations() {
    if (Object.keys(entry.annotations).length === 0) return;
    if (!confirm('清空所有已查的英文释义？')) return;
    setEntry((prev) => ({ ...prev, annotations: {} }));
  }

  const renderedAnnotations = useMemo<Record<string, AnnotationState>>(() => {
    const out: Record<string, AnnotationState> = { ...entry.annotations };
    for (const w of loadingWords) out[w] = 'loading';
    return out;
  }, [entry.annotations, loadingWords]);

  const annCount = Object.keys(entry.annotations).length;
  const noAudio = !audioFile;
  const canAnchor = !noAudio && aligned;

  return (
    <div className={`app reader-view ${anchorMode ? 'anchor-mode' : ''}`}>
      <header className="app-header reader-header">
        <button
          className="iconbtn back"
          onClick={onBack}
          aria-label="返回书架"
        >
          <IconBack size={22} />
        </button>
        <div className="reader-title" title={entry.name}>
          {entry.name}
        </div>
        <button
          type="button"
          className={`iconbtn anchor-btn ${anchorMode ? 'active' : ''}`}
          onClick={() => setAnchorMode((m) => !m)}
          disabled={!canAnchor}
          aria-label={anchorMode ? '取消对齐' : '对齐当前播放段'}
          title={anchorMode ? '取消对齐' : '对齐当前播放段'}
        >
          <IconPin size={18} />
        </button>
        <label
          className={`iconbtn audio-pick ${noAudio ? 'highlight' : ''}`}
          aria-label="选择 / 更换音频"
          title={noAudio ? '选择音频' : '更换音频'}
        >
          <input
            type="file"
            accept="audio/*"
            onChange={(e) =>
              e.target.files && setAudioFile(e.target.files[0])
            }
          />
          {noAudio ? <IconHeadphones size={18} /> : <IconRefresh size={18} />}
        </label>
        {annCount > 0 && (
          <button
            className="vocab-pill"
            onClick={clearAnnotations}
            aria-label={`清空 ${annCount} 条释义`}
            title={`清空 ${annCount} 条释义`}
          >
            <span className="vocab-count">{annCount}</span>
            <IconClose size={12} />
          </button>
        )}
      </header>

      <audio
        ref={audioRef}
        {...(audioUrl ? { src: audioUrl } : {})}
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={(e) => tryResume(e.currentTarget)}
        style={{ display: 'none' }}
      />

      {error && <div className="error">{error}</div>}

      {anchorMode && (
        <div className="anchor-banner" role="status">
          <span>👆 点一下你现在听到的那一段</span>
          <button
            type="button"
            className="anchor-cancel"
            onClick={() => setAnchorMode(false)}
          >
            取消
          </button>
        </div>
      )}

      <div className="reader" ref={readerRef}>
        {segments.map((s) => (
          <p
            key={s.id}
            id={`seg-${s.id}`}
            className={[
              'segment',
              s.id === activeId ? 'active' : '',
              s.matched ? 'matched' : 'unmatched',
            ].join(' ')}
            onClick={() => handleSegmentClick(s)}
            title={
              anchorMode
                ? '点此把当前播放点对齐到这一段'
                : ''
            }
          >
            {s.matched && !noAudio && (
              <button
                type="button"
                className="seg-play"
                onClick={(e) => onSegmentPlay(s, e)}
                disabled={anchorMode}
                aria-label="跳到这一段开始播放"
                title="跳到这一段"
              >
                <IconPlay size={11} />
              </button>
            )}
            <AnnotatedText
              text={s.text}
              annotations={renderedAnnotations}
              onWordClick={handleWordClick}
              disabled={anchorMode}
            />
          </p>
        ))}
      </div>

      {!noAudio && (
        <Player
          audioRef={audioRef}
          currentTime={currentTime}
          duration={duration}
          disabled={!aligned}
        />
      )}
    </div>
  );
}
