import { useEffect, useMemo, useRef, useState } from 'react';
import {
  alignByLengthDistribution,
  type DocSegment,
} from '../lib/aligner';
import { lookupWord, type DictResult } from '../lib/dict';
import {
  putEntry,
  type LibraryEntry,
} from '../lib/library';
import { splitParagraphs } from '../lib/textNormalize';
import AnnotatedText, { type AnnotationState } from './AnnotatedText';
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
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

  // 拿到音频时长 → 立刻按字数均匀分布做对齐。
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

  // 音频元数据加载后：恢复上次播放位置 + 写入音频时长到 entry
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    setDuration(a.duration);
    setEntry((prev) => ({ ...prev, audioDurationSec: a.duration }));
    if (
      !resumedRef.current &&
      entry.lastPositionSec > 1 &&
      entry.lastPositionSec < a.duration - 5
    ) {
      a.currentTime = entry.lastPositionSec;
      resumedRef.current = true;
    }
  }

  // 累计听了多久（仅在 playing 时计时）+ 进度回写。
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let last = a.currentTime;
    let acc = 0;
    let timer: number | null = null;
    const tick = () => {
      const now = a.currentTime;
      // 用户拖动跳转不计入累计
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
    timer = window.setInterval(tick, 1000);
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  // 进度同步到 entry（每秒最多写一次内存状态，IDB 写入再防抖）
  useEffect(() => {
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

  // 退出时立即写一次最新状态。
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

  // 阅读区内部滚动
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

  // 单击 vs 双击：250ms 计时器区分。
  const clickTimerRef = useRef<number | null>(null);
  function handleSegmentClick(seg: DocSegment) {
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

  // 点词查英英
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

  // 合并 entry.annotations + loadingWords 给渲染层
  const renderedAnnotations = useMemo<Record<string, AnnotationState>>(() => {
    const out: Record<string, AnnotationState> = { ...entry.annotations };
    for (const w of loadingWords) out[w] = 'loading';
    return out;
  }, [entry.annotations, loadingWords]);

  const annCount = Object.keys(entry.annotations).length;
  const noAudio = !audioFile;

  return (
    <div className="app reader-view">
      <header className="app-header reader-header">
        <button className="iconbtn back" onClick={onBack} aria-label="返回">
          ‹
        </button>
        <div className="reader-title" title={entry.name}>
          {entry.name}
        </div>
        <label className="iconbtn audio-pick" aria-label="选择 / 更换音频">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) =>
              e.target.files && setAudioFile(e.target.files[0])
            }
          />
          <span aria-hidden>{noAudio ? '🎧' : '🔄'}</span>
        </label>
        {annCount > 0 && (
          <button
            className="iconbtn ann-clear"
            onClick={clearAnnotations}
            aria-label={`清空 ${annCount} 条释义`}
            title={`清空 ${annCount} 条释义`}
          >
            ✕<small>{annCount}</small>
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
        style={{ display: 'none' }}
      />

      {error && <div className="error">{error}</div>}

      {noAudio && (
        <div className="audio-prompt">
          <label className="upload-card">
            <input
              type="file"
              accept="audio/*"
              onChange={(e) =>
                e.target.files && setAudioFile(e.target.files[0])
              }
            />
            <span className="icon" aria-hidden>🎧</span>
            <span className="text">
              <span className="t">选择配套音频</span>
              <span className="s">MP3 / WAV / M4A …</span>
            </span>
          </label>
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
              s.matched
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
