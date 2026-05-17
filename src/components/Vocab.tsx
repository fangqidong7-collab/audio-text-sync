import { useEffect, useState } from 'react';
import {
  clearAllMastery,
  listVocab,
  setMastered,
  type VocabItem,
} from '../lib/library';
import { IconCheck, IconClose, IconSparkles } from './Icons';
import VocabReview from './VocabReview';

const REVIEW_SIZE_KEY = 'vocab-review-size';
const SIZE_OPTIONS = [5, 10, 15, 20, 30];

function readSize(): number {
  try {
    const raw = localStorage.getItem(REVIEW_SIZE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && SIZE_OPTIONS.includes(n)) return n;
  } catch {
    /* ignore */
  }
  return 10;
}
function writeSize(n: number) {
  try {
    localStorage.setItem(REVIEW_SIZE_KEY, String(n));
  } catch {
    /* ignore */
  }
}

export default function Vocab() {
  const [items, setItems] = useState<VocabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [size, setSize] = useState<number>(readSize);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setItems(await listVocab());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggleMastered(item: VocabItem) {
    try {
      await setMastered(item.word, !item.mastered);
      setItems((prev) =>
        prev.map((it) =>
          it.word === item.word
            ? {
                ...it,
                mastered: !it.mastered,
                masteredAt: !it.mastered ? Date.now() : undefined,
              }
            : it,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleReset() {
    if (!confirm('清空所有"已掌握"标记？\n词汇本身不会消失。')) return;
    try {
      await clearAllMastery();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (reviewing) {
    return (
      <VocabReview
        items={items}
        count={size}
        onDone={() => {
          setReviewing(false);
          void refresh();
        }}
      />
    );
  }

  const total = items.length;
  const mastered = items.filter((i) => i.mastered).length;
  const remaining = total - mastered;
  const canReview = items.length >= 4;

  return (
    <div className="vocab">
      {loading ? (
        <div className="empty-hint">加载中…</div>
      ) : items.length === 0 ? (
        <div className="empty-hint">
          还没查过任何英文词。
          <br />
          阅读时点一下英文单词就会查英英释义，词都会自动收集到这里。
        </div>
      ) : (
        <>
          <div className="vocab-summary">
            <div className="vocab-stat">
              <span className="vocab-stat-num">{mastered}</span>
              <span className="vocab-stat-lab">已掌握</span>
            </div>
            <div className="vocab-stat">
              <span className="vocab-stat-num">{remaining}</span>
              <span className="vocab-stat-lab">待巩固</span>
            </div>
            <div className="vocab-stat">
              <span className="vocab-stat-num">{total}</span>
              <span className="vocab-stat-lab">总词数</span>
            </div>
          </div>

          <div className="vocab-progress">
            <div
              className="vocab-progress-fill"
              style={{
                width: total > 0 ? `${(mastered / total) * 100}%` : '0',
              }}
            />
          </div>

          <div className="vocab-actions">
            <label className="size-pick">
              <span className="size-lab">每轮</span>
              <select
                value={size}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setSize(n);
                  writeSize(n);
                }}
              >
                {SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} 词
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!canReview}
              onClick={() => setReviewing(true)}
              title={!canReview ? '至少 4 个词才能出四选一' : '开始复习'}
            >
              <IconSparkles size={16} />
              开始复习
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          <ul className="vocab-list">
            {items.map((item) => (
              <li
                key={item.word}
                className={`vocab-item ${item.mastered ? 'mastered' : ''}`}
              >
                <div className="vocab-item-head">
                  <span className="vocab-word">{item.word}</span>
                  {item.result.phonetic && (
                    <span className="vocab-phon">{item.result.phonetic}</span>
                  )}
                  {item.result.pos && (
                    <span className="vocab-pos">{item.result.pos}</span>
                  )}
                  <button
                    type="button"
                    className={`vocab-toggle ${item.mastered ? 'on' : ''}`}
                    onClick={() => toggleMastered(item)}
                    aria-label={item.mastered ? '取消已掌握' : '标记已掌握'}
                    title={item.mastered ? '取消已掌握' : '标记已掌握'}
                  >
                    {item.mastered ? (
                      <IconCheck size={16} />
                    ) : (
                      <IconClose size={14} />
                    )}
                  </button>
                </div>
                <div className="vocab-def">{item.result.def}</div>
                {item.sources.length > 0 && (
                  <div className="vocab-sources">
                    出自：{item.sources.slice(0, 2).join('、')}
                    {item.sources.length > 2 &&
                      ` 等 ${item.sources.length} 篇`}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {mastered > 0 && (
            <button
              type="button"
              className="vocab-reset"
              onClick={handleReset}
            >
              清空已掌握标记
            </button>
          )}
        </>
      )}
    </div>
  );
}
