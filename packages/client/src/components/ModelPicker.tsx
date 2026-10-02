import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, Star, Zap } from 'lucide-react';
import type { ProviderDescriptor } from '@jam/protocol';
import { moveMenuFocus, useAnchoredMenu } from './anchored-menu';
import { modelMenu, type Choice, type ComposerChoices, type ModelChoice } from './composer-model';

/**
 * The composer's model pill and its searchable menu (Paper, "11 · Model
 * picker"): the provider's default, starred models, current models and the
 * provider's older versions folded under Legacy. Alt+1–9 picks the numbered
 * models; the composer handles those keys so they work with the menu closed.
 */
export function ModelPicker({
  descriptor,
  choices,
  icon,
  altKey,
  disabled,
  onChange,
  onFavorite,
}: {
  descriptor?: ProviderDescriptor;
  choices: ComposerChoices;
  icon?: React.ReactNode;
  /** The Alt key's label on this platform, for the shortcut hints. */
  altKey: string;
  disabled?: boolean;
  onChange(model: string): void;
  onFavorite?(model: string): void;
}) {
  const [query, setQuery] = useState('');
  const [legacyOpen, setLegacyOpen] = useState(false);
  const { open, place, root, trigger, menu, layer, toggle, close, tabOut } = useAnchoredMenu({
    onOpened: (element) => element.querySelector<HTMLInputElement>('input')?.focus(),
  });
  const current = choices.models.find((item) => item.value === choices.model) ?? choices.models[0];
  if (!current) return null;
  const groups = modelMenu(descriptor, choices, query);
  const searching = !!query.trim();
  // Searching, or a chat already on a legacy model, shows the legacy models.
  const legacyShown =
    searching || legacyOpen || groups.legacy.some((item) => item.value === choices.model);

  const finish = () => {
    setQuery('');
    close(true);
  };
  const choose = (value: string) => {
    finish();
    if (value !== choices.model) onChange(value);
  };
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
  ];

  const option = (item: Choice | ModelChoice) => {
    const selected = item.value === choices.model;
    const model = 'favorite' in item ? item : undefined;
    const shortcut = groups.shortcuts.indexOf(item.value);
    return (
      <div key={item.value || 'default'} className={`model-option ${selected ? 'selected' : ''}`}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          className="choice-option"
          onClick={() => choose(item.value)}
        >
          <span className="choice-option-copy">
            <strong>
              {item.label}
              {model?.fast && (
                <Zap size={10} className="model-fast" fill="currentColor" strokeWidth={0} />
              )}
            </strong>
            {item.description && <small>{item.description}</small>}
          </span>
          {shortcut >= 0 && (
            <kbd className="model-shortcut">
              {altKey} {shortcut + 1}
            </kbd>
          )}
          <span className="choice-option-check">
            {selected && <Check size={12} strokeWidth={2} />}
          </span>
        </button>
        {model && onFavorite && (
          <button
            type="button"
            tabIndex={-1}
            className={`model-star ${model.favorite ? 'on' : ''}`}
            aria-label={`${model.favorite ? 'Unstar' : 'Star'} ${item.label}`}
            aria-pressed={model.favorite}
            onClick={() => onFavorite(item.value)}
          >
            <Star size={13} fill={model.favorite ? 'currentColor' : 'none'} strokeWidth={1.6} />
          </button>
        )}
      </div>
    );
  };

  const nothing =
    !groups.default && !groups.favorites.length && !groups.models.length && !groups.legacy.length;

  return (
    <div className="choice model" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="choice-pill composer-pill strong"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${current.label}`}
        title={current.description ?? 'Model'}
        disabled={disabled}
        onClick={() => {
          if (open) return finish();
          // However it last closed (a choice, Escape, a press outside), it opens unfiltered.
          setQuery('');
          toggle();
        }}
      >
        {icon}
        <span className="choice-pill-value">{current.label}</span>
        <ChevronDown size={10} className="composer-chevron" />
      </button>
      {open &&
        layer(
          <div
            ref={menu}
            className="choice-menu model-menu"
            role="menu"
            aria-label="Model"
            style={place}
            onKeyDown={(event) => {
              if (moveMenuFocus(event, items())) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                finish();
              } else if (event.key === 'Tab') tabOut();
            }}
          >
            <label className="model-search">
              <Search size={13} />
              <input
                aria-label="Search models"
                placeholder="Search models"
                value={query}
                maxLength={80}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter takes the first match.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    items()[0]?.click();
                  }
                }}
              />
            </label>
            <div className="model-list">
              {groups.default && option(groups.default)}
              {!!groups.favorites.length && (
                <div className="choice-section" role="group" aria-label="Favorites">
                  <span className="choice-section-label">Favorites</span>
                  {groups.favorites.map(option)}
                </div>
              )}
              {!!groups.models.length && (
                <div className="choice-section" role="group" aria-label="Models">
                  {!!groups.favorites.length && (
                    <span className="choice-section-label">Models</span>
                  )}
                  {groups.models.map(option)}
                </div>
              )}
              {!!groups.legacy.length && (
                <div className="choice-section legacy" role="group" aria-label="Legacy models">
                  <button
                    type="button"
                    className="model-legacy-toggle"
                    aria-expanded={legacyShown}
                    disabled={searching}
                    onClick={() => setLegacyOpen((shown) => !shown)}
                  >
                    {legacyShown ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    <span className="choice-section-label">Legacy models</span>
                    <span className="model-legacy-count">{groups.legacy.length}</span>
                  </button>
                  {legacyShown && groups.legacy.map(option)}
                </div>
              )}
              {nothing && <p className="model-empty">No models match “{query.trim()}”.</p>}
            </div>
          </div>,
        )}
    </div>
  );
}
