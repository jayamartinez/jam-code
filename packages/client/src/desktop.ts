export interface DesktopServices {
  platform: 'windows' | 'macos' | 'web';
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
}
