import { useMemo, useState } from 'react';
import { setMastered, type VocabItem } from '../lib/library';
import { IconArrowRight, IconCheck, IconClose } from './Icons';

interface Props {
  items: VocabItem[];
  count: number;
  onDone: () => void;
}

interface Question {
  word: string;
  // options[i].def 是显示文本，pos 用于在选项前小字标注
  options: { pos?: string; def: string }[];
  correctIdx: number;
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildQuestions(items: VocabItem[], count: number): Question[] {
  // 优先抽未掌握的；不足时再用已掌握的兜底。
  const pool = items.filter((i) => i.result.def);
  const unmastered = pool.filter((i) => !i.mastered);
  const mastered = pool.filter((i) => i.mastered);
  const order = [...shuffle(unmastered), ...shuffle(mastered)];
  const target = Math.min(count, order.length);
  const picked = order.slice(0, target);

  return picked.map((it) => {
    // 干扰项：从同池其他词里随机挑 3 个释义
    const distractorPool = pool.filter(
      (p) => p.word !== it.word && p.result.def !== it.result.def,
    );
    const distractors = shuffle(distractorPool).slice(0, 3);
    const options = shuffle([
      { pos: it.result.pos, def: it.result.def },
      ...distractors.map((d) => ({ pos: d.result.pos, def: d.result.def })),
    ]);
    const correctIdx = options.findIndex(
      (o) => o.def === it.result.def && o.pos === it.result.pos,
    );
    return { word: it.word, options, correctIdx };
  });
}

export default function VocabReview({ items, count, onDone }: Props) {
  const questions = useMemo(
    () => buildQuestions(items, count),
    [items, count],
  );
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [marked, setMarked] = useState<string[]>([]);

  if (questions.length === 0) {
    return (
      <div className="review-empty">
        <p>词汇还不够 4 个，没法出题。</p>
        <button className="btn-primary" onClick={onDone}>
          回去查更多词
        </button>
      </div>
    );
  }

  const finished = idx >= questions.length;

  if (finished) {
    return (
      <div className="review-done">
        <div className="review-done-head">
          <div className="review-done-score">
            {score} / {questions.length}
          </div>
          <div className="review-done-sub">
            {score === questions.length
              ? '全部答对，新增 ' + marked.length + ' 个已掌握'
              : `本轮新增 ${marked.length} 个已掌握`}
          </div>
        </div>
        <button className="btn-primary" onClick={onDone}>
          完成
        </button>
      </div>
    );
  }

  const q = questions[idx];

  function handlePick(i: number) {
    if (picked !== null) return;
    setPicked(i);
    if (i === q.correctIdx) {
      setScore((s) => s + 1);
      // 答对就标记已掌握
      void setMastered(q.word, true).catch(() => undefined);
      setMarked((arr) => [...arr, q.word]);
    }
  }

  function next() {
    setPicked(null);
    setIdx((n) => n + 1);
  }

  return (
    <div className="review">
      <div className="review-head">
        <div className="review-progress">
          <div
            className="review-progress-fill"
            style={{
              width: `${((idx + (picked !== null ? 1 : 0)) / questions.length) * 100}%`,
            }}
          />
        </div>
        <div className="review-step">
          {idx + 1} / {questions.length}
        </div>
      </div>

      <div className="review-card">
        <div className="review-word">{q.word}</div>
        <div className="review-hint">选出正确的英文释义</div>
        <div className="review-options">
          {q.options.map((opt, i) => {
            const isCorrect = i === q.correctIdx;
            const isPicked = picked === i;
            const showState = picked !== null;
            const cls = [
              'review-option',
              showState && isCorrect ? 'correct' : '',
              showState && isPicked && !isCorrect ? 'wrong' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={i}
                type="button"
                className={cls}
                disabled={showState}
                onClick={() => handlePick(i)}
              >
                <span className="review-option-text">
                  {opt.pos && (
                    <span className="review-pos">{opt.pos}</span>
                  )}
                  {opt.def}
                </span>
                {showState && isCorrect && (
                  <span className="review-mark good">
                    <IconCheck size={14} />
                  </span>
                )}
                {showState && isPicked && !isCorrect && (
                  <span className="review-mark bad">
                    <IconClose size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {picked !== null && (
        <button type="button" className="btn-primary" onClick={next}>
          下一题
          <IconArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
