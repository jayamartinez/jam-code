import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import type { DesktopServices } from '../desktop';
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
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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

export function Brand({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`}>jam</span>;
}

export function Shortcut({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
