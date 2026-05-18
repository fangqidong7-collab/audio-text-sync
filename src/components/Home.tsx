import { useState } from 'react';
import type { LibraryEntry } from '../lib/library';
import { IconNotebook, IconShelf } from './Icons';
import Docs from './Docs';
import Vocab from './Vocab';

interface Props {
  onOpen: (entry: LibraryEntry) => void;
}

type Tab = 'docs' | 'vocab';

export default function Home({ onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('docs');
  const [docCount, setDocCount] = useState<number | null>(null);
  const [docLoading, setDocLoading] = useState(true);

  return (
    <div className="app home">
      <header className="app-header">
        <h1>同读</h1>
        <span className="meta">
          {tab === 'docs'
            ? docLoading || docCount == null
              ? '…'
              : `${docCount} 篇`
            : '词汇表'}
        </span>
      </header>

      <div className="tabbar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'docs'}
          className={`tab ${tab === 'docs' ? 'active' : ''}`}
          onClick={() => setTab('docs')}
        >
          <IconShelf size={16} />
          书架
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'vocab'}
          className={`tab ${tab === 'vocab' ? 'active' : ''}`}
          onClick={() => setTab('vocab')}
        >
          <IconNotebook size={16} />
          单词
        </button>
      </div>

      <main className="home-main">
        {tab === 'vocab' ? (
          <Vocab />
        ) : (
          <Docs
            onOpen={onOpen}
            onCountChange={setDocCount}
            onLoadingChange={setDocLoading}
          />
        )}
      </main>
    </div>
  );
}
