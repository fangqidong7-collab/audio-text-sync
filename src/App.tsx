import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { splitSentences } from './lib/textNormalize';
import {
  alignByLengthDistribution,
  alignDocumentToAudio,
  type DocSegment,
  type TimedChunk,
} from './lib/aligner';
import { transcribe, type TranscribeProgress } from './lib/asr';
import { extractPdfText, type PdfParseProgress } from './lib/pdfParse';

type Mode = 'manual' | 'auto';

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
  const [mode, setMode] = useState<Mode>('manual');
  const [language, setLanguage] = useState<'auto' | 'chinese' | 'english'>('auto');
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
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
      const sents = splitSentences(text).map((t, i) => ({
        id: i,
        text: t,
        matched: false as const,
      }));
      setSegments(sents);
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
      if (mode === 'manual') {
        // 等 metadata 加载好以拿到时长
        const dur = duration || (await waitForDuration());
        const aligned = alignByLengthDistribution(segments, dur);
        setSegments(aligned);
      } else {
        const chunks: TimedChunk[] = await transcribe(
          audioFile,
          { language },
          setProgress,
        );
        const aligned = alignDocumentToAudio(segments, chunks, {
          minConfidence: 0.5,
          monotonic: true,
        });
        setSegments(aligned);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setAligning(false);
      setProgress(null);
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>音画同步阅读器</h1>
        <div className="hint">
          上传文档 + 音频，自动对齐，边听边读
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
          <fieldset className="mode">
            <legend>对齐模式</legend>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
              />
              手动 (按字数均匀分布)
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === 'auto'}
                onChange={() => setMode('auto')}
              />
              自动 (Whisper 识别 + 模糊匹配)
            </label>
          </fieldset>

          {mode === 'auto' && (
            <label className="lang">
              语言：
              <select
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value as 'auto' | 'chinese' | 'english')
                }
              >
                <option value="auto">自动</option>
                <option value="chinese">中文</option>
                <option value="english">English</option>
              </select>
            </label>
          )}

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

        {progress && (
          <div className="progress">
            <div className="progress-msg">{progress.message}</div>
            {progress.progress !== undefined && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.progress * 100).toFixed(1)}%` }}
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
            还没有内容。请上传一个 <code>.txt</code> 或 <code>.md</code> 文档。
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
              onClick={() => jumpTo(s)}
              title={
                s.matched
                  ? `${formatTime(s.start)} - ${formatTime(s.end)} · 置信度 ${(
                      (s.confidence ?? 0) * 100
                    ).toFixed(0)}%`
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
