import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ThemeRef } from '@jam/protocol';
import {
  LIBRARY_GROUPS,
  preferredVariant,
  searchLibrary,
  specimenColors,
  type LibraryFamily,
  type LibraryGroup,
  type LibraryVariant,
  type SearchHit,
} from '../../appearance/library';
import type { Scheme } from '../../appearance/themes';

/**
 * The theme library: JAM's themes, the reader's own and the editor-style
 * families, each group collapsible to one line of chips. Every card is a
 * specimen drawn in the theme's own colors; each pane in it is one variant
 * and choosing it applies that variant. Search lists variants one by one.
 */

function paneStyle(variant: LibraryVariant): CSSProperties {
  const c = specimenColors(variant.theme);
  return {
    '--s-canvas': c.canvas,
    '--s-sidebar': c.sidebar,
    '--s-rule': c.rule,
    '--s-bar': c.bar,
    '--s-text': c.text,
    '--s-muted': c.muted,
    '--s-keyword': c.keyword,
    '--s-string': c.string,
    '--s-number': c.number,
    '--s-function': c.function,
    '--s-punctuation': c.punctuation,
    '--s-comment': c.comment,
    '--s-accent': c.accent,
  } as CSSProperties;
}

function SpecimenPane({
  variant,
  selected,
  focused,
  onChoose,
}: {
  variant: LibraryVariant;
  selected: boolean;
  focused?: boolean;
  onChoose(): void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={variant.theme.name}
      className={`ap-pane ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      style={paneStyle(variant)}
      onClick={onChoose}
    >
      <span className="ap-pane-side" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="ap-pane-code" aria-hidden="true">
        <span>
          <b className="k">const </b>
          <b className="t">mode</b>
          <b className="p"> = </b>
          <b className="s">&apos;glass&apos;</b>
        </span>
        <span>
          <b className="f">render</b>
          <b className="p">(</b>
          <b className="n">42</b>
          <b className="p">)</b>
        </span>
        <span>
          <b className="c">{'// ready'}</b>
        </span>
        <span className="ap-pane-foot">
          <i />
          main
        </span>
      </span>
    </button>
  );
}

function variantsLabel(family: LibraryFamily) {
  return family.variants
    .map((variant) =>
      family.variants.filter((item) => item.theme.scheme === variant.theme.scheme).length > 1 &&
      variant.theme.name.startsWith(family.name)
        ? variant.theme.name.slice(family.name.length).trim() || variant.theme.scheme
        : variant.theme.scheme === 'light'
          ? 'Light'
          : 'Dark',
    )
    .join(' · ');
}

function FamilyCard({
  family,
  current,
  onTheme,
  onEdit,
}: {
  family: LibraryFamily;
  current: ThemeRef;
  onTheme(ref: ThemeRef): void;
  onEdit?(): void;
}) {
  const selected = family.variants.some((variant) => variant.ref === current);
  return (
    <div className={`ap-family ${selected ? 'selected' : ''}`}>
      <div className="ap-family-panes" role="radiogroup" aria-label={family.name}>
        {family.variants.map((variant) => (
          <SpecimenPane
            key={variant.ref}
            variant={variant}
            selected={variant.ref === current}
            onChoose={() => onTheme(variant.ref)}
          />
        ))}
      </div>
      <div className="ap-family-label">
        <strong>{family.name}</strong>
        {onEdit && (
          <button type="button" className="ap-family-edit" onClick={onEdit}>
            Edit
          </button>
        )}
        <span className="ap-family-variants">{variantsLabel(family)}</span>
        {selected && (
          <span className="ap-family-check" aria-hidden="true">
            ✓
          </span>
        )}
      </div>
    </div>
  );
}

function FamilyChip({
  family,
  scheme,
  current,
  onTheme,
}: {
  family: LibraryFamily;
  scheme: Scheme;
  current: ThemeRef;
  onTheme(ref: ThemeRef): void;
}) {
  const target = preferredVariant(family, scheme);
  const selected = family.variants.some((variant) => variant.ref === current);
  return (
    <button
      type="button"
      className={`ap-chip ${selected ? 'selected' : ''}`}
      onClick={() => onTheme(target.ref)}
      title={target.theme.name}
    >
      <span className="ap-chip-swatch" aria-hidden="true">
        {family.variants.slice(0, 2).map((variant) => (
          <i key={variant.ref} style={{ background: variant.theme.surfaces.pane[0] }} />
        ))}
      </span>
      <span
        className="ap-chip-dot"
        style={{ background: target.theme.accent }}
        aria-hidden="true"
      />
      {family.name}
    </button>
  );
}

function Highlighted({ hit }: { hit: SearchHit }) {
  const name = hit.variant.theme.name;
  if (!hit.highlight) return <>{name}</>;
  const [from, to] = hit.highlight;
  return (
    <>
      {name.slice(0, from)}
      <mark>{name.slice(from, to)}</mark>
      {name.slice(to)}
    </>
  );
}

function SearchResults({
  hits,
  families,
  active,
  current,
  onTheme,
}: {
  hits: SearchHit[];
  families: LibraryFamily[];
  active: number;
  current: ThemeRef;
  onTheme(ref: ThemeRef): void;
}) {
  return (
    <>
      {LIBRARY_GROUPS.map(({ id, label }) => {
        const inGroup = hits.filter((hit) => hit.family.group === id);
        if (!families.some((family) => family.group === id)) return null;
        if (!inGroup.length)
          return (
            <div key={id} className="ap-group-empty">
              <span className="ap-group-chevron collapsed" aria-hidden="true" />
              {label}
              <small>No matches</small>
            </div>
          );
        return (
          <section key={id} className="ap-group">
            <div className="ap-group-header">
              <span className="ap-group-toggle static">
                <span className="ap-group-chevron" />
                {label}
                <small>{inGroup.length}</small>
              </span>
            </div>
            <div className="ap-grid" role="radiogroup" aria-label={`${label} matches`}>
              {inGroup.map((hit) => (
                <div
                  key={hit.variant.ref}
                  className={`ap-family single ${hit.variant.ref === current ? 'selected' : ''}`}
                >
                  <div className="ap-family-panes">
                    <SpecimenPane
                      variant={hit.variant}
                      selected={hit.variant.ref === current}
                      focused={hits[active] === hit}
                      onChoose={() => onTheme(hit.variant.ref)}
                    />
                  </div>
                  <div className="ap-family-label">
                    <strong>
                      <Highlighted hit={hit} />
                    </strong>
                    <span className="ap-family-variants">
                      {hit.variant.theme.scheme === 'light' ? 'Light' : 'Dark'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

export function Library({
  families,
  current,
  scheme,
  onTheme,
  onNew,
  onImport,
  onEdit,
  canAdd,
}: {
  families: LibraryFamily[];
  current: ThemeRef;
  scheme: Scheme;
  onTheme(ref: ThemeRef): void;
  onNew(): void;
  onImport(file: File): void;
  onEdit(customId: string): void;
  canAdd: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<LibraryGroup>>(() => new Set());
  const file = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchLibrary(families, query), [families, query]);
  const searching = query.trim().length > 0;
  const total = families.reduce((sum, family) => sum + family.variants.length, 0);
  const groups = LIBRARY_GROUPS.filter(({ id }) => families.some((family) => family.group === id));
  const allCollapsed = groups.every(({ id }) => collapsed.has(id));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hits.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + delta + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      const hit = hits[active];
      if (hit) onTheme(hit.variant.ref);
    } else if (event.key === 'Escape' && query) {
      // Clearing the search is the whole of this Escape; Settings stays open.
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  const toggle = (id: LibraryGroup) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="sv-section ap-library" aria-labelledby="appearance-library">
      <div className="ap-library-header">
        <h3 id="appearance-library">Library</h3>
        <span className="sv-mono">
          {searching
            ? `${hits.length} of ${total} themes`
            : `${families.length} families · ${total} themes`}
        </span>
        <span className="ap-spacer" />
        <label className={`ap-search ${searching ? 'active' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <input
            type="search"
            aria-label="Search themes"
            placeholder="Search themes"
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {searching && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </label>
        <button
          type="button"
          className="sv-button ap-icon-button"
          aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          disabled={searching}
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(groups.map(({ id }) => id)))
          }
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d={
                allCollapsed
                  ? 'M4.5 3L8 6.5 11.5 3M4.5 13L8 9.5 11.5 13'
                  : 'M4.5 6.5L8 3l3.5 3.5M4.5 9.5L8 13l3.5-3.5'
              }
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="sv-button" disabled={!canAdd} onClick={onNew}>
          + New theme
        </button>
        <button
          type="button"
          className="sv-button"
          disabled={!canAdd}
          onClick={() => file.current?.click()}
        >
          Import…
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,.jsonc,application/json"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onImport(chosen);
            event.target.value = '';
          }}
        />
      </div>

      {searching ? (
        <SearchResults
          hits={hits}
          families={families}
          active={active}
          current={current}
          onTheme={onTheme}
        />
      ) : (
        groups.map(({ id, label }) => {
          const inGroup = families.filter((family) => family.group === id);
          const closed = collapsed.has(id);
          return (
            <section key={id} className={`ap-group ${closed ? 'collapsed' : ''}`}>
              <div className="ap-group-header">
                <button
                  type="button"
                  className="ap-group-toggle"
                  aria-expanded={!closed}
                  onClick={() => toggle(id)}
                >
                  <span className={`ap-group-chevron ${closed ? 'collapsed' : ''}`} />
                  {label}
                  <small>{inGroup.length}</small>
                </button>
                {closed && (
                  <span className="ap-chips">
                    {inGroup.map((family) => (
                      <FamilyChip
                        key={family.key}
                        family={family}
                        scheme={scheme}
                        current={current}
                        onTheme={onTheme}
                      />
                    ))}
                  </span>
                )}
              </div>
              {!closed && (
                <div className="ap-grid">
                  {inGroup.map((family) => (
                    <FamilyCard
                      key={family.key}
                      family={family}
                      current={current}
                      onTheme={onTheme}
                      {...(family.customId ? { onEdit: () => onEdit(family.customId!) } : {})}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
