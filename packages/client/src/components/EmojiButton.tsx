/** The first emoji in `text`, as one grapheme (flags, skin tones, ZWJ sequences). */
export function firstEmoji(text: string): string | null {
  return emojisIn(text)[0] ?? null;
}

function emojisIn(text: string): string[] {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  return [...segments]
    .map(({ segment }) => segment)
    .filter((segment) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment));
}

/**
 * The emoji itself is the control: clicking it opens the operating system's
 * picker (the Windows emoji panel, the macOS Character Viewer), never a list
 * JAM maintains, and what you pick replaces it. The tile is a real text field
 * because the picker types into the focused field; keys are ignored, so there
 * is nothing to type.
 */
export function EmojiButton({
  value,
  onChange,
  onOpenPicker,
}: {
  value: string;
  onChange(emoji: string): void;
  /** Opens the system picker; absent where the host has none. */
  onOpenPicker?(): Promise<void>;
}) {
  const shown = value || '🙂';
  return (
    <input
      className={`emoji-tile ${value ? '' : 'placeholder'}`}
      aria-label={value ? `Emoji ${value}. Choose another` : 'Choose an emoji'}
      title={onOpenPicker ? 'Choose an emoji' : 'Open your emoji picker to choose'}
      value={shown}
      spellCheck={false}
      autoComplete="off"
      onClick={(event) => {
        // Selected, so the picked emoji replaces the current one.
        event.currentTarget.select();
        void onOpenPicker?.();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.select();
          void onOpenPicker?.();
        } else if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
        }
      }}
      onPaste={(event) => event.preventDefault()}
      onChange={(event) => {
        // The new emoji is whichever one was not there before.
        const picked = emojisIn(event.target.value).filter((emoji) => emoji !== shown);
        const emoji = picked[picked.length - 1];
        if (emoji) onChange(emoji);
      }}
    />
  );
}
