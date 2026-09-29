import { useRef } from 'react';

/** The first emoji in `text`, as one grapheme (flags, skin tones, ZWJ sequences). */
export function firstEmoji(text: string): string | null {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  for (const { segment } of segments) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) return segment;
  }
  return null;
}

/**
 * Picks an emoji with the operating system's own picker (the Windows emoji
 * panel, the macOS Character Viewer), never a list JAM maintains. The picker
 * types into whatever field has focus, so a hidden field takes focus first
 * and anything that is not an emoji is ignored: there is nothing to type.
 */
export function EmojiButton({
  value,
  onChange,
  onOpenPicker,
  platform,
}: {
  value: string;
  onChange(emoji: string): void;
  /** Opens the system picker; absent where the host has none. */
  onOpenPicker?(): Promise<void>;
  platform: 'macos' | 'windows' | 'web';
}) {
  const field = useRef<HTMLInputElement>(null);
  const shortcut = platform === 'macos' ? '⌃⌘ Space' : 'Win .';
  return (
    <div className="emoji-button">
      <span className="emoji-button-preview" aria-hidden="true">
        {value || '🙂'}
      </span>
      <button
        type="button"
        className="emoji-button-open"
        disabled={!onOpenPicker}
        title={onOpenPicker ? undefined : 'The emoji picker needs the desktop app'}
        onClick={() => {
          field.current?.focus();
          void onOpenPicker?.();
        }}
      >
        {value ? 'Change emoji…' : 'Choose emoji…'}
        <kbd>{shortcut}</kbd>
      </button>
      <input
        ref={field}
        className="emoji-button-sink"
        aria-label="Emoji"
        tabIndex={-1}
        value=""
        onChange={(event) => {
          const emoji = firstEmoji(event.target.value);
          if (emoji) onChange(emoji);
        }}
      />
    </div>
  );
}
