import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, History, Search, X } from 'lucide-react';
import type {
  JamTransport,
  Project,
  ProviderId,
  Resource,
  SearchResult,
  Session,
} from '@jam/protocol';
import { loadRecentSearches, rememberSearch, saveRecentSearches } from '../state/recent-searches';
import { compactAge } from '../state/threads';
import { Dialog, IconButton, Shortcut } from './Controls';
import { ProviderIcon } from './icons';

/** How many recent chats show before anything is typed. */
const RECENT_CHAT_LIMIT = 8;

export function SearchDialog({
  transport,
  projects,
  resources,
  sessions,
  onClose,
  onOpen,
}: {
  transport: JamTransport;
  projects: Project[];
  /** Workspace records, for the recent chats shown before a query. */
  resources: Resource[];
  sessions: Session[];
  onClose(): void;
  onOpen(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [pinned, setPinned] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const idle = !query.trim();
  const sessionOf = (resource: Resource) =>
    sessions.find((session) => session.id === resource.sessionId);
  // Before a query, the same filters narrow the recent chats.
  const recentChats = useMemo(
    () =>
      resources
        .filter(
          (resource) =>
            resource.kind === 'conversation' &&
            (!projectId || resource.projectId === projectId) &&
            (!pinned || resource.pinned) &&
            (!providerId ||
              sessions.find((session) => session.id === resource.sessionId)?.providerId ===
                providerId),
        )
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, RECENT_CHAT_LIMIT),
    [resources, sessions, projectId, providerId, pinned],
  );
  /**
   * One keyboard list: recent searches, then recent chats, or the results.
   * The pointer selects on movement, not on entry, so a row that appears
   * under a resting pointer does not steal the keyboard's selection.
   */
  const itemCount = idle ? recentSearches.length + recentChats.length : results.length;
  const updateRecent = (next: string[]) => {
    setRecentSearches(next);
    saveRecentSearches(next);
  };
  const openResult = (resourceId: string) => {
    // Only a search that led somewhere is worth offering again.
    if (!idle) updateRecent(rememberSearch(recentSearches, query));
    onOpen(resourceId);
  };
  const choose = (index: number) => {
    if (!idle) {
      if (results[index]) openResult(results[index].resourceId);
      return;
    }
    if (index < recentSearches.length) setQuery(recentSearches[index]!);
    else {
      const chat = recentChats[index - recentSearches.length];
      if (chat) onOpen(chat.id);
    }
  };
  useEffect(() => setSelected(0), [idle]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        setStatus('');
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
              setSelected((value) => Math.min(value + 1, itemCount - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((value) => Math.max(0, value - 1));
            }
            if (event.key === 'Enter') choose(selected);
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
      {status && (
        <p className="search-status" role="status">
          {status}
        </p>
      )}
      <div className="search-results">
        {idle && recentSearches.length > 0 && (
          <div className="search-section-label">
            Recent searches
            <button className="search-clear" onClick={() => updateRecent([])}>
              Clear
            </button>
          </div>
        )}
        {idle &&
          recentSearches.map((recent, index) => (
            <div
              key={recent}
              className={`search-recent ${selected === index ? 'selected' : ''}`}
              onMouseMove={() => setSelected(index)}
            >
              <button className="search-recent-query" onClick={() => setQuery(recent)}>
                <History size={14} />
                <span className="truncate">{recent}</span>
              </button>
              <IconButton
                label={`Forget ${recent}`}
                className="icon-button search-forget"
                onClick={() => updateRecent(recentSearches.filter((item) => item !== recent))}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}
        {idle && (
          <div className="search-section-label">
            Recent chats
            {!recentChats.length && <span>None match these filters.</span>}
          </div>
        )}
        {idle &&
          recentChats.map((chat, offset) => {
            const index = recentSearches.length + offset;
            return (
              <button
                key={chat.id}
                className={`search-chat ${selected === index ? 'selected' : ''}`}
                onMouseMove={() => setSelected(index)}
                onClick={() => onOpen(chat.id)}
              >
                <ProviderIcon presentation={sessionOf(chat)?.presentation} />
                <span className="search-chat-title truncate">{chat.title}</span>
                <span className="search-chat-meta">
                  {projects.find((project) => project.id === chat.projectId)?.name}
                  {chat.closedAt ? ' · closed' : ''} · {compactAge(chat.updatedAt, Date.now())}
                </span>
              </button>
            );
          })}
        {!idle &&
          results.map((result, index) => (
            <button
              className={`search-result ${selected === index ? 'selected' : ''}`}
              key={result.resourceId}
              onClick={() => openResult(result.resourceId)}
            >
              <ProviderIcon
                presentation={result.presentation}
                label={result.presentation === 'codex' ? 'Codex' : 'Claude Code'}
              />
              <span className="search-result-copy">
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
