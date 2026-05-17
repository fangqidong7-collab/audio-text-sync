import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { splitParagraphs } from './lib/textNormalize';
import {
  alignByLengthDistribution,
  type DocSegment,
} from './lib/aligner';
import { extractPdfText, type PdfParseProgress } from './lib/pdfParse';

function formatTime(t: number | undefined): string {
  if (t === undefined || !Number.isFinite(t)) return '--:--';
  const s = Math.max(0, Math.floor(t));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function App() {
  const [docFile, setDocFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [segments, setSegments] = useState<DocSegment[]>([]);
  const [pdfProgress, setPdfProgress] = useState<PdfParseProgress | null>(null);
  const [aligning, setAligning] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const audioUrl = useMemo(
    () => (audioFile ? URL.createObjectURL(audioFile) : ''),
    [audioFile],
  );
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 读取文档文本
  async function handleDocFile(f: File) {
    setDocFile(f);
    setError(null);
    setParsing(true);
    setPdfProgress(null);
    try {
      const isPdf =
        f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const text = isPdf
        ? await extractPdfText(f, setPdfProgress)
        : await f.text();
      const paras = splitParagraphs(text).map((t, i) => ({
        id: i,
        text: t,
        matched: false as const,
      }));
      setSegments(paras);
    } catch (e) {
      setError(`文档解析失败：${e instanceof Error ? e.message : String(e)}`);
      setSegments([]);
    } finally {
      setParsing(false);
      setPdfProgress(null);
    }
  }

  function handleAudioFile(f: File) {
    setAudioFile(f);
    setError(null);
  }

  async function runAlign() {
    if (segments.length === 0 || !audioFile) {
      setError('请先上传文档和音频。');
      return;
    }
    setAligning(true);
    setError(null);
    try {
      const dur = duration || (await waitForDuration());
      const aligned = alignByLengthDistribution(segments, dur);
      setSegments(aligned);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setAligning(false);
    }
  }

  function waitForDuration(): Promise<number> {
    return new Promise((resolve) => {
      const a = audioRef.current;
      if (!a) return resolve(0);
      if (Number.isFinite(a.duration) && a.duration > 0) return resolve(a.duration);
      const handler = () => {
        resolve(a.duration);
        a.removeEventListener('loadedmetadata', handler);
      };
      a.addEventListener('loadedmetadata', handler);
    });
  }

  // 当前正在朗读的段落
  const activeId = useMemo(() => {
    let id: number | null = null;
    for (const s of segments) {
      if (
        s.matched &&
        s.start !== undefined &&
        s.end !== undefined &&
        currentTime >= s.start &&
        currentTime <= s.end
      ) {
        id = s.id;
        break;
      }
    }
    return id;
  }, [segments, currentTime]);

  // 自动滚动到当前段落（只在阅读区内部滚动，不会带飞整个页面）
  // 用 getBoundingClientRect 计算相对偏移，避开 offsetTop 受 offsetParent 影响的坑。
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

  // 双击重锚：把当前音频时间作为该段的开始，后续段落按字符数重新均匀分布到剩余时长。
  // 不动音频本身，只是修正段落 → 时间的映射。
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

  // 单击 vs 双击：用一个 250ms 计时器区分（onDblClick 默认会先触发两次 onClick，体验差）。
  const clickTimerRef = useRef<number | null>(null);
  function handleSegmentClick(seg: DocSegment) {
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>音画同步阅读器</h1>
        <div className="hint">
          上传文档 + 音频，自动对齐，边听边读 ·
          <span className="op"> 单击段落跳转音频 · 双击段落对齐当前播放点</span>
        </div>
      </header>

      <section className="controls">
        <div className="control-row">
          <label className="filebtn">
            <input
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              onChange={(e) => e.target.files && handleDocFile(e.target.files[0])}
            />
            <span>1. 选择文档（.pdf / .txt / .md）</span>
            {docFile && <em>{docFile.name}</em>}
          </label>

          <label className="filebtn">
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => e.target.files && handleAudioFile(e.target.files[0])}
            />
            <span>2. 选择音频</span>
            {audioFile && <em>{audioFile.name}</em>}
          </label>
        </div>

        <div className="control-row">
          <button
            className="primary"
            disabled={!docFile || !audioFile || aligning || parsing}
            onClick={runAlign}
          >
            {aligning ? '对齐中…' : '开始对齐'}
          </button>
        </div>

        {parsing && (
          <div className="progress">
            <div className="progress-msg">
              {pdfProgress
                ? `解析 PDF 第 ${pdfProgress.page} / ${pdfProgress.totalPages} 页`
                : '解析文档…'}
            </div>
            {pdfProgress && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${(
                      (pdfProgress.page / pdfProgress.totalPages) *
                      100
                    ).toFixed(1)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {error && <div className="error">⚠ {error}</div>}
      </section>

      <section className="player">
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
        <div className="player-meta">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </section>

      <section className="reader" ref={readerRef}>
        {segments.length === 0 ? (
          <div className="empty">
            还没有内容。请上传一个 <code>.pdf</code>、<code>.txt</code> 或 <code>.md</code> 文档。
          </div>
        ) : (
          segments.map((s) => (
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
                  ? `${formatTime(s.start)} - ${formatTime(s.end)}\n单击：跳转音频到此段\n双击：把当前播放点对齐到此段`
                  : '未在音频中匹配到（或还未对齐）'
              }
            >
              <span className="seg-time">{formatTime(s.start)}</span>
              <span className="seg-text">{s.text}</span>
            </p>
          ))
        )}
      </section>

      <footer className="foot">
        <span>
          匹配状态：{segments.filter((s) => s.matched).length} / {segments.length}
        </span>
      </footer>
    </div>
  );
}
