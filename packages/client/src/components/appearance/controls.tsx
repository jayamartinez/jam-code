import { useMemo, useState } from 'react';
import { APPEARANCE, FONT_FAMILY } from '@jam/protocol';
import { isFontAvailable, type FontChoice } from '../../appearance/fonts';
import { MenuSelect } from '../MenuSelect';

/** The Appearance page's own controls; everything else comes from the Settings v2 set. */

export function Slider({
  label,
  value,
  range: [min, max],
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  unit: string;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <span className="appearance-slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <output className="mono">
        {value}
        {unit}
      </output>
    </span>
  );
}

function sizes([min, max]: readonly [number, number]) {
  const values: number[] = [];
  for (let value = min; value <= max; value++) values.push(value);
  return values;
}

export function NumberSelect({
  label,
  value,
  range,
  format,
  onChange,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  format(value: number): string;
  onChange(value: number): void;
}) {
  return (
    <MenuSelect
      className="sv-select mono"
      label={label}
      value={String(value)}
      options={sizes(range).map((size) => ({ value: String(size), label: format(size) }))}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

const OTHER = '\u0000other';

/**
 * A family from a short list of common faces (marked when this computer does
 * not have them), or any installed family typed by name.
 */
export function FontSelect({
  label,
  value,
  choices,
  inherit,
  onChange,
}: {
  label: string;
  value: string;
  choices: FontChoice[];
  /** Label for `''` when the field follows another font instead of the bundled one. */
  inherit?: string;
  onChange(value: string): void;
}) {
  const known = choices.some((choice) => choice.value === value);
  const [typing, setTyping] = useState(!known);
  const [draft, setDraft] = useState(known ? '' : value);
  const options = useMemo(
    () =>
      choices.map((choice) => ({
        ...choice,
        missing: !!choice.value && !isFontAvailable(choice.value),
      })),
    [choices],
  );
  const valid = FONT_FAMILY.test(draft) && draft.length <= APPEARANCE.limits.fontUtf16;
  return (
    <span className="font-select">
      {typing && (
        <input
          className="font-name"
          aria-label={`${label} name`}
          placeholder="Family name"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => valid && draft.trim() && onChange(draft.trim())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid && draft.trim()) onChange(draft.trim());
          }}
        />
      )}
      <MenuSelect
        className="sv-select"
        label={label}
        value={typing ? OTHER : value}
        options={[
          ...(inherit ? [{ value: '', label: inherit }] : []),
          ...options
            .filter((choice) => !(inherit && choice.value === ''))
            .map((choice) => ({
              value: choice.value,
              label: choice.label,
              ...(choice.missing
                ? { description: 'Not installed' }
                : choice.note
                  ? { description: choice.note }
                  : {}),
            })),
          { value: OTHER, label: 'Other installed font…' },
        ]}
        onChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(next);
        }}
      />
      {typing && draft.trim() && valid && !isFontAvailable(draft.trim()) && (
        <small className="font-warning">Not found on this computer</small>
      )}
    </span>
  );
}

/** A colour role as a swatch pill: the native picker behind a swatch and its hex. */
export function ColourInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="ap-colour">
      <span className="ap-colour-swatch" style={{ background: value }} aria-hidden="true" />
      <span className="ap-colour-hex">{value.toUpperCase()}</span>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
      />
    </label>
  );
}
