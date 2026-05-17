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
  IconRefresh,
} from './Icons';
import Player from './Player';

interface Props {
  initialEntry: LibraryEntry;
  onBack: () => void;
}

function fmtTime(t: number | undefined): string {
  if (t === undefined || !Number.isFinite(t)) return '--:--';
  const s = Math.max(0, Math.floor(t));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function Reader({ initialEntry, onBack }: Props) {
  const [entry, setEntry] = useState<LibraryEntry>(initialEntry);
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
      // 立刻同步 React state，避免 UI 显示 00:00
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

  // 进度回写到 entry。注意：恢复完成前不能允许 timeupdate 把 lastPositionSec 写成 0。
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

  // 防抖写 IndexedDB
  useEffect(() => {
    const t = window.setTimeout(() => {
      putEntry(entry).catch((e) => console.error('保存进度失败：', e));
    }, 600);
    return () => window.clearTimeout(t);
  }, [entry]);

  // 退出时立即写一次最终状态。
  useEffect(() => {
    return () => {
      void putEntry(entry).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function reAnchor(seg: DocSegment) {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const T = a.currentTime;
    const dur = a.duration;
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === seg.id);
      if (idx < 0) return prev;
      const tail = prev.slice(idx);
      const totalChars = tail.reduce(
        (acc, s) => acc + Math.max(s.text.length, 1),
        0,
      );
      const remaining = Math.max(dur - T, 0.01);
      let t = T;
      return prev.map((s, i) => {
        if (i < idx) return s;
        const len = Math.max(s.text.length, 1);
        const d = (len / totalChars) * remaining;
        const out = {
          ...s,
          start: t,
          end: t + d,
          matched: true as const,
        };
        t += d;
        return out;
      });
    });
  }

  // 段落点击：
  // - 锚定模式 → 该段重锚到当前播放点，自动退出锚定模式
  // - 默认：单击跳转音频，双击重锚（250ms 内）
  const clickTimerRef = useRef<number | null>(null);
  function handleSegmentClick(seg: DocSegment) {
    if (anchorMode) {
      reAnchor(seg);
      setAnchorMode(false);
      return;
    }
    if (!aligned) return;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      reAnchor(seg);
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      jumpTo(seg);
    }, 250);
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
        src={audioUrl}
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
                : s.matched
                  ? `${fmtTime(s.start)} – ${fmtTime(s.end)}\n单击：跳转音频\n双击：对齐当前播放点`
                  : '请先选择音频以开始对齐'
            }
          >
            {s.matched && (
              <span className="seg-time">{fmtTime(s.start)}</span>
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
