import { Check, ChevronDown } from 'lucide-react';
import { moveMenuFocus, useAnchoredMenu } from './anchored-menu';

export interface PillChoice {
  value: string;
  label: string;
  description?: string;
  /** Shown before the label, such as Fast's bolt. */
  mark?: React.ReactNode;
}

/** One titled group of choices in a menu that sets more than one thing. */
export interface ChoiceSection {
  label: string;
  value: string;
  values: PillChoice[];
  onChange(value: string): void;
}

/**
 * A composer pill that opens a menu of choices, each with its explanation
 * (Paper, "9 · Approvals & access"; "10 · Composer pickers"). Access, model
 * and effort all use it; effort adds a Speed section when a model offers one.
 * The menu is fixed to the pill, so a toolbar that clips its overflow cannot
 * hide it, and it stays inside the window.
 */
export function ChoicePill({
  label,
  value,
  values,
  onChange,
  disabled,
  compact,
  className,
  rootClassName,
  menuClassName,
  icon,
  optionIcon,
  sections,
  summary,
}: {
  /** What is being chosen, for assistive technology. */
  label: string;
  value: string;
  values: PillChoice[];
  onChange(value: string): void;
  disabled?: boolean;
  /** Opens downward, for the quieter pill in a new chat's footer. */
  compact?: boolean;
  className: string;
  rootClassName?: string;
  /** Sizes the menu, which is drawn outside the pill's own element. */
  menuClassName?: string;
  icon?: React.ReactNode;
  optionIcon?(value: string): React.ReactNode;
  /** Titled groups shown after the main choices, each set independently. */
  sections?: ChoiceSection[];
  /** The pill's text when it sums up more than the main choice. */
  summary?: string;
}) {
  const current = values.find((item) => item.value === value) ?? values[0];
  const { open, place, root, trigger, menu, layer, toggle, close, tabOut } = useAnchoredMenu({
    compact,
    // Focus the chosen item, so arrow keys start from it.
    onOpened: (element) =>
      (
        element.querySelector<HTMLElement>('[aria-checked="true"]') ??
        element.querySelector('button')
      )?.focus(),
  });

  if (!current) return null;

  const onMenuKey = (event: React.KeyboardEvent) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    if (moveMenuFocus(event, items)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') tabOut();
  };

  const options = (items: PillChoice[], chosen: string, choose: (value: string) => void) =>
    items.map((item) => {
      const selected = item.value === chosen;
      return (
        <button
          key={item.value}
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          className={`choice-option ${selected ? 'selected' : ''}`}
          onClick={() => {
            close(true);
            if (!selected) choose(item.value);
          }}
        >
          {optionIcon && <span className="choice-option-icon">{optionIcon(item.value)}</span>}
          <span className="choice-option-copy">
            <strong>
              {item.mark}
              {item.label}
            </strong>
            {item.description && <small>{item.description}</small>}
          </span>
          <span className="choice-option-check">
            {selected && <Check size={12} strokeWidth={2} />}
          </span>
        </button>
      );
    });

  return (
    <div className={`choice ${rootClassName ?? ''} ${compact ? 'compact' : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`choice-pill ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${summary ?? current.label}`}
        title={current.description ?? label}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        {icon}
        <span className="choice-pill-value">{summary ?? current.label}</span>
        <ChevronDown size={10} className="composer-chevron" />
      </button>
      {open &&
        layer(
          <div
            ref={menu}
            className={`choice-menu ${menuClassName ?? ''}`}
            role="menu"
            aria-label={label}
            style={place}
            onKeyDown={onMenuKey}
          >
            {sections?.length ? (
              <>
                <div className="choice-section" role="group" aria-label={label}>
                  <span className="choice-section-label">{label}</span>
                  {options(values, current.value, onChange)}
                </div>
                {sections.map((section) => (
                  <div
                    key={section.label}
                    className="choice-section"
                    role="group"
                    aria-label={section.label}
                  >
                    <span className="choice-section-label">{section.label}</span>
                    {options(section.values, section.value, section.onChange)}
                  </div>
                ))}
              </>
            ) : (
              options(values, current.value, onChange)
            )}
          </div>,
        )}
    </div>
  );
}
