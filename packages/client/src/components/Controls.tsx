import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import type { DesktopServices } from '../desktop';
import { BrandMark } from './BrandMark';
import { useOccludesNativeViews } from '../state/native-occlusion';

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

/**
 * macOS keeps the host's own traffic lights; JAM only reserves space for them
 * (see `TrafficLightInset`). Windows draws its controls on the right.
 */
export function WindowControls({ desktop }: { desktop: DesktopServices }) {
  if (desktop.platform === 'macos') return null;
  const unavailable = desktop.platform === 'web';
  return (
    <div className="window-controls">
      <IconButton
        label={unavailable ? 'Window controls are available in the desktop app' : 'Minimize window'}
        disabled={unavailable}
        onClick={() => void desktop.minimize()}
      >
        <Minus size={12} />
      </IconButton>
      <IconButton
        label="Maximize or restore window"
        disabled={unavailable}
        onClick={() => void desktop.toggleMaximize()}
      >
        <Maximize2 size={11} />
      </IconButton>
      <IconButton
        label="Hide window to tray"
        disabled={unavailable}
        onClick={() => void desktop.close()}
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  /** Whether the pointer is on the scrim around the dialog, not on the dialog. */
  const onBackdrop = (event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };
  useOccludesNativeViews();
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      className={`dialog ${className}`}
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = onBackdrop(event);
      }}
      onClick={(event) => {
        // Only a press that both began and ended on the backdrop dismisses.
        // A text selection dragged out of the dialog ends as a click on the
        // dialog element, and so does a click on its own padding.
        if (pressedBackdrop.current && onBackdrop(event)) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {children}
    </dialog>
  );
}

/**
 * Reserved space for the host's native macOS traffic lights.
 *
 * The buttons themselves are drawn by the window server at the inset the
 * desktop host configures; JAM never draws duplicates. This keeps the one
 * place that knows about macOS chrome geometry inside the chrome components.
 */
export function TrafficLightInset() {
  return <span className="traffic-light-inset" aria-hidden="true" />;
}

/** The mark with the `jam` wordmark; `compact` is the mark alone for the rail. */
export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <span className="brand compact" role="img" aria-label="jam">
        <BrandMark size={20} />
      </span>
    );
  return (
    <span className="brand">
      <BrandMark size={18} />
      <span className="wordmark">jam</span>
    </span>
  );
}

export function Shortcut({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
