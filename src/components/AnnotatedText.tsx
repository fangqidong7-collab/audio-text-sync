import type { DictEntry } from '../lib/dict';

export type AnnotationState = DictEntry | 'not-found' | 'loading';

interface Props {
  text: string;
  annotations: Record<string, AnnotationState>;
  onWordClick: (word: string) => void;
}

// 匹配英文词（含撇号缩略：don't、it's）。中文/数字/标点都不在这里命中。
const WORD_RE = /[a-zA-Z]+(?:['’][a-zA-Z]+)?/g;

export default function AnnotatedText({
  text,
  annotations,
  onWordClick,
}: Props) {
  const parts: Array<{ kind: 'word' | 'gap'; text: string; idx: number }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  let i = 0;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ kind: 'gap', text: text.slice(last, m.index), idx: i++ });
    }
    parts.push({ kind: 'word', text: m[0], idx: i++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'gap', text: text.slice(last), idx: i++ });
  }

  return (
    <>
      {parts.map((p) => {
        if (p.kind === 'gap') return <span key={p.idx}>{p.text}</span>;
        const lc = p.text.toLowerCase();
        const ann = annotations[lc];
        const cls =
          'word' +
          (ann && typeof ann === 'object' ? ' has-def' : '') +
          (ann === 'loading' ? ' loading' : '') +
          (ann === 'not-found' ? ' unknown' : '');
        return (
          <span
            key={p.idx}
            className={cls}
            onClick={(e) => {
              e.stopPropagation();
              onWordClick(p.text);
            }}
          >
            {p.text}
            {ann === 'loading' && <span className="def-loading">…</span>}
            {ann === 'not-found' && (
              <span className="def-na" title="未找到释义">?</span>
            )}
            {ann && typeof ann === 'object' && (
              <span className="def">
                {ann.pos && <em className="pos">{ann.pos.slice(0, 4)}.</em>}
                {ann.def}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}
