import { ChoicePill, type PillChoice } from './ChoicePill';

/**
 * A field that picks one value from a menu: the composer's pickers (Paper,
 * "10 · Composer pickers") with a field-shaped trigger, in place of the
 * platform's `<select>`, whose popup ignores the theme and differs per OS.
 */
export function MenuSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  /** What is being chosen, for assistive technology. */
  label: string;
  value: T;
  options: readonly (PillChoice & { value: T })[];
  onChange?(value: T): void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ChoicePill
      label={label}
      value={value}
      values={[...options]}
      onChange={(next) => onChange?.(next as T)}
      disabled={disabled || !onChange}
      compact
      rootClassName="menu-select-root"
      menuClassName="select-menu"
      className={`menu-select ${className ?? ''}`}
    />
  );
}
