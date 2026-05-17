import { useEffect, useRef, useState, type RefObject } from 'react';
import { IconPause, IconPlay, IconSkipBack, IconSkipForward } from './Icons';

interface Props {
  audioRef: RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  disabled?: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '--:--';
  const s = Math.floor(t);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function Player({ audioRef, currentTime, duration, disabled }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  }, [audioRef]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = SPEEDS[speedIdx];
  }, [speedIdx, audioRef]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  }

  function skip(delta: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + delta));
  }

  function seekFromPointer(clientX: number): number | undefined {
    const track = trackRef.current;
    const a = audioRef.current;
    if (!track || !a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * a.duration;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = seekFromPointer(e.clientX);
    if (t === undefined) return;
    setScrubbing(true);
    setScrubT(t);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!scrubbing) return;
    const t = seekFromPointer(e.clientX);
    if (t === undefined) return;
    setScrubT(t);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!scrubbing) return;
    const t = seekFromPointer(e.clientX);
    setScrubbing(false);
    const a = audioRef.current;
    if (a && t !== undefined) a.currentTime = t;
  }

  const shownT = scrubbing ? scrubT : currentTime;
  const ratio =
    duration > 0 ? Math.max(0, Math.min(1, shownT / duration)) * 100 : 0;
  const speedLabel = SPEEDS[speedIdx] === 1 ? '1×' : `${SPEEDS[speedIdx]}×`;

  return (
    <div className={`player compact ${disabled ? 'disabled' : ''}`}>
      <div
        className="scrubber"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={shownT}
        aria-label="播放进度"
      >
        <div className="scrubber-track">
          <div className="scrubber-fill" style={{ width: `${ratio}%` }} />
          <div className="scrubber-thumb" style={{ left: `${ratio}%` }} />
        </div>
      </div>
      <div className="player-row">
        <div className="player-side player-left">
          <span className="time">{fmt(shownT)}</span>
        </div>
        <div className="player-center">
          <button
            type="button"
            className="iconbtn skip"
            onClick={() => skip(-5)}
            disabled={disabled}
            aria-label="后退 5 秒"
          >
            <IconSkipBack size={18} />
            <small className="skip-num">5</small>
          </button>
          <button
            type="button"
            className="iconbtn play"
            onClick={toggle}
            disabled={disabled}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
          <button
            type="button"
            className="iconbtn skip"
            onClick={() => skip(5)}
            disabled={disabled}
            aria-label="前进 5 秒"
          >
            <IconSkipForward size={18} />
            <small className="skip-num">5</small>
          </button>
        </div>
        <div className="player-side player-right">
          <button
            type="button"
            className="speed"
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
            aria-label={`变速：${speedLabel}`}
          >
            {speedLabel}
          </button>
          <span className="time">{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}
