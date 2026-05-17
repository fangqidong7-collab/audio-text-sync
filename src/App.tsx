import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { splitParagraphs } from './lib/textNormalize';
import {
  alignByLengthDistribution,
  type DocSegment,
} from './lib/aligner';
import { extractPdfText, type PdfParseProgress } from './lib/pdfParse';
import { lookupWord } from './lib/dict';
import Player from './components/Player';
import AnnotatedText, {
  type AnnotationState,
} from './components/AnnotatedText';

function fmtTime(t: number | undefined): string {
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
  const [aligned, setAligned] = useState(false);
  const [annotations, setAnnotations] = useState<
    Record<string, AnnotationState>
  >({});

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

  async function handleDocFile(f: File) {
    setDocFile(f);
    setError(null);
    setAligned(false);
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
    setAligned(false);
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
      const out = alignByLengthDistribution(segments, dur);
      setSegments(out);
      setAligned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  // 当前段落
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

  // 阅读区内部滚动到活动段落（不带飞页面）
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

  // 点词查英英释义；再次点击同一个词即取消标注。
  async function handleWordClick(word: string) {
    const lc = word.toLowerCase();
    const current = annotations[lc];
    if (current === 'loading') return;
    if (current !== undefined) {
      setAnnotations((prev) => {
        const next = { ...prev };
        delete next[lc];
        return next;
      });
      return;
    }
    setAnnotations((prev) => ({ ...prev, [lc]: 'loading' }));
    try {
      const r = await lookupWord(word);
      setAnnotations((prev) => ({ ...prev, [lc]: r }));
    } catch (e) {
      setAnnotations((prev) => {
        const next = { ...prev };
        delete next[lc];
        return next;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function clearAnnotations() {
    setAnnotations({});
  }

  // 单击 vs 双击：250ms 计时器区分。
  const clickTimerRef = useRef<number | null>(null);
  function handleSegmentClick(seg: DocSegment) {
    if (!aligned) {
      // 还没对齐，单击就是跳转：但因为没时间戳所以无效。给个轻提示。
      setError('请先点"开始对齐"');
      return;
    }
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

  const ready = !!docFile && !!audioFile;
  const hasReader = segments.length > 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1>音画同步阅读器</h1>
        <span className="meta">
          {hasReader && aligned
            ? `${segments.length} 段 · 双击对齐 · 点词查释义`
            : hasReader
              ? '点击"开始对齐"进入阅读'
              : '上传文档和音频即可开始'}
        </span>
      </header>

      {/* 隐藏的真实 audio 元素，控件由 Player 组件接管 */}
      <audio
        ref={audioRef}
        src={audioUrl}
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        style={{ display: 'none' }}
      />

      <main className="app-main">
        {!hasReader ? (
          <div className="empty-state">
            <div className="title">📖 边听边读，随声而行</div>
            <div className="sub">
              上传一份 PDF / TXT / Markdown，再选一段配套音频，即可在阅读时跟随朗读自动滚动。
            </div>
            <div className="upload-cards">
              <UploadCard
                title="选择文档"
                hint={docFile ? docFile.name : 'PDF / TXT / Markdown'}
                filled={!!docFile}
                accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                icon="📄"
                onPick={handleDocFile}
              />
              <UploadCard
                title="选择音频"
                hint={audioFile ? audioFile.name : 'MP3 / WAV / M4A …'}
                filled={!!audioFile}
                accept="audio/*"
                icon="🎧"
                onPick={handleAudioFile}
              />
            </div>
            {parsing && <ParseProgress pdfProgress={pdfProgress} />}
            {error && <div className="error">{error}</div>}
          </div>
        ) : (
          <>
            <div className="file-bar">
              <div className="row">
                <span className="label">文档</span>
                <span className="name">{docFile?.name}</span>
                <label className="swap">
                  更换
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                    onChange={(e) =>
                      e.target.files && handleDocFile(e.target.files[0])
                    }
                  />
                </label>
              </div>
              <div className="row">
                <span className="label">音频</span>
                <span className="name">
                  {audioFile?.name}
                  {duration > 0 && (
                    <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                      {fmtTime(duration)}
                    </span>
                  )}
                </span>
                <label className="swap">
                  更换
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) =>
                      e.target.files && handleAudioFile(e.target.files[0])
                    }
                  />
                </label>
              </div>

              <div className="actions">
                {!aligned && (
                  <button
                    className="primary"
                    disabled={!ready || aligning || parsing}
                    onClick={runAlign}
                  >
                    {aligning ? '对齐中…' : '开始对齐'}
                  </button>
                )}
                {parsing && (
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {pdfProgress
                      ? `解析 PDF ${pdfProgress.page}/${pdfProgress.totalPages}`
                      : '解析文档…'}
                  </span>
                )}
                {Object.keys(annotations).length > 0 && (
                  <button
                    className="ghost"
                    onClick={clearAnnotations}
                    style={{ marginLeft: 'auto' }}
                  >
                    清空标注（{Object.keys(annotations).length}）
                  </button>
                )}
              </div>
            </div>

            {parsing && <ParseProgress pdfProgress={pdfProgress} />}
            {error && <div className="error">{error}</div>}

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
                      : '尚未对齐'
                  }
                >
                  {s.matched && (
                    <span className="seg-time">{fmtTime(s.start)}</span>
                  )}
                  <AnnotatedText
                    text={s.text}
                    annotations={annotations}
                    onWordClick={handleWordClick}
                  />
                </p>
              ))}
            </div>
          </>
        )}
      </main>

      {ready && (
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

function UploadCard({
  title,
  hint,
  filled,
  accept,
  icon,
  onPick,
}: {
  title: string;
  hint: string;
  filled: boolean;
  accept: string;
  icon: string;
  onPick: (f: File) => void;
}) {
  return (
    <label className={`upload-card ${filled ? 'filled' : ''}`}>
      <input
        type="file"
        accept={accept}
        onChange={(e) => e.target.files && onPick(e.target.files[0])}
      />
      <span className="icon" aria-hidden>
        {icon}
      </span>
      <span className="text">
        <span className="t">{title}</span>
        <span className="s">{hint}</span>
      </span>
    </label>
  );
}

function ParseProgress({ pdfProgress }: { pdfProgress: PdfParseProgress | null }) {
  return (
    <div className="progress">
      <div>
        {pdfProgress
          ? `解析 PDF 第 ${pdfProgress.page} / ${pdfProgress.totalPages} 页`
          : '解析文档…'}
      </div>
      {pdfProgress && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${((pdfProgress.page / pdfProgress.totalPages) * 100).toFixed(1)}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
