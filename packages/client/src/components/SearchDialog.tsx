import { useEffect, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import type { JamTransport, Project, ProviderId, SearchResult } from '@jam/protocol';
import { Dialog, IconButton, Shortcut } from './Controls';
import { ProviderGlyph } from './Sidebar';

export function SearchDialog({
  transport,
  projects,
  onClose,
  onOpen,
}: {
  transport: JamTransport;
  projects: Project[];
  onClose(): void;
  onOpen(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [pinned, setPinned] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState(
    'Type to search your conversations, messages and tool activity.',
  );
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        setStatus('Type to search your conversations, messages and tool activity.');
        return;
      }
      setStatus('Searching…');
      void transport
        .request('search.query', {
          query,
          ...(projectId ? { projectId } : {}),
          ...(providerId ? { providerId: providerId as ProviderId } : {}),
          ...(pinned ? { pinned: true } : {}),
        })
        .then(
          ({ results: next }) => {
            if (alive) {
              setResults(next);
              setSelected(0);
              setStatus(
                next.length
                  ? `${next.length} result${next.length === 1 ? '' : 's'}`
                  : 'No matches. Try a title, path or word from a message.',
              );
            }
          },
          (error: unknown) => {
            if (alive) {
              setResults([]);
              setStatus(error instanceof Error ? error.message : 'Search is unavailable.');
            }
          },
        );
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, projectId, providerId, pinned, transport]);
  return (
    <Dialog title="Search all history" onClose={onClose} className="search-dialog">
      <div className="search-dialog-input">
        <Search size={18} />
        <input
          aria-label="Search all history"
          placeholder="Search all history…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={256}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((value) => Math.max(0, value - 1));
            }
            if (event.key === 'Enter' && results[selected]) onOpen(results[selected].resourceId);
          }}
        />
        <IconButton label="Close search" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="search-filters">
        <select
          aria-label="Search project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Any project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Search provider"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          <option value="">Any provider</option>
          <option value="mock">Mock</option>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />{' '}
          Pinned only
        </label>
      </div>
      <p className="search-status" role="status">
        {status}
      </p>
      <div className="search-results">
        {results.map((result, index) => (
          <button
            className={`search-result ${selected === index ? 'selected' : ''}`}
            key={result.resourceId}
            onClick={() => onOpen(result.resourceId)}
          >
            <ProviderGlyph presentation={result.presentation} />
            <span>
              <strong>{result.title}</strong>
              <p>{result.snippet}</p>
              <small>
                {projects.find((project) => project.id === result.projectId)?.name} · Mock
              </small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <footer className="dialog-footer">
        <span>
          <Shortcut>↑ ↓</Shortcut> navigate <Shortcut>↵</Shortcut> open
        </span>
        <span>
          <Shortcut>Esc</Shortcut> close
        </span>
      </footer>
    </Dialog>
  );
}
