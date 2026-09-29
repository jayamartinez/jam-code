export interface DesktopServices {
  platform: 'windows' | 'macos' | 'web';
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  /**
   * The operating system's folder chooser. Resolves to the chosen folder's
   * path, or `null` when the chooser was cancelled. Absent where the host
   * has no local folders, such as the browser preview or a future remote
   * client.
   */
  pickDirectory?(): Promise<string | null>;
  /** Native Browser views. Absent where the host cannot embed one. */
  browser?: BrowserHost;
  snapshots?: SnapshotHost;
}

/** A rectangle in the interface's CSS pixels, relative to the window. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserPageState {
  url: string;
  title: string;
  loading: boolean;
  /** `null` when the platform cannot say; the control stays usable. */
  canGoBack: boolean | null;
  canGoForward: boolean | null;
  /** Why the last navigation was refused. */
  blocked: string | null;
}

/**
 * One annotation made in annotate mode: a clicked element or a dragged
 * region, with the reader's comment. Every other field came from the page,
 * which can say anything about itself, so it is shown and sent as page data.
 */
export interface BrowserAnnotation {
  kind: 'element' | 'region';
  comment: string;
  /** For a region, the selectors of the elements it mostly covers. */
  selector: string;
  label: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  url: string;
  title: string;
  console: { level: string; text: string; at: number }[];
  consoleErrors: number;
}

export type BrowserHostEvent =
  | { type: 'state'; state: BrowserPageState }
  | { type: 'annotated'; annotation: BrowserAnnotation }
  | { type: 'annotateEnded' };

export type BrowserAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'focus'
  | 'annotate'
  | 'stopAnnotating'
  | 'clearAnnotations';

/**
 * The host owns each Browser resource's native view. A pane reports where the
 * page should appear, or `null` when it should not be visible; unmounting a
 * pane hides the page and never ends it. Only `close` does.
 */
export interface BrowserHost {
  attach(
    resourceId: string,
    bounds: BrowserBounds | null,
    listener: (event: BrowserHostEvent) => void,
  ): Promise<BrowserPageState>;
  setBounds(resourceId: string, bounds: BrowserBounds | null): Promise<void>;
  navigate(resourceId: string, url: string): Promise<void>;
  action(resourceId: string, action: BrowserAction): Promise<void>;
  close(resourceId: string): Promise<void>;
}

/**
 * The desktop host's view of Snapshots. `message` is empty while everything
 * works and explains only a problem the user can act on.
 */
export interface SnapshotShortcutStatus {
  state: 'registered' | 'disabled' | 'needsPermission' | 'unavailable';
  message: string;
  latestId: string | null;
  /** The one macOS permission Snapshots needs. */
  screenRecording: boolean;
}
export type SnapshotHostAction =
  | 'status'
  | 'retry'
  | 'requestScreenRecording'
  | 'openScreenRecordingSettings'
  | 'capture'
  | 'dismiss'
  | 'open';
export interface SnapshotHost {
  action(action: SnapshotHostAction, id?: string): Promise<SnapshotShortcutStatus>;
  subscribe(listener: () => void): Promise<() => void>;
  onOpen(listener: (id: string | null) => void): Promise<() => void>;
}
