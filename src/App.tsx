import { useState } from 'react';
import './App.css';
import Home from './components/Home';
import Reader from './components/Reader';
import type { LibraryEntry } from './lib/library';

export default function App() {
  const [activeEntry, setActiveEntry] = useState<LibraryEntry | null>(null);

  if (!activeEntry) {
    return <Home onOpen={setActiveEntry} />;
  }

  return (
    <Reader
      key={activeEntry.hash}
      initialEntry={activeEntry}
      onBack={() => setActiveEntry(null)}
    />
  );
}
