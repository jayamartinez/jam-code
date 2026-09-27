import type { ContextItem } from './types';

/**
 * Key combinations Snapshots offers, mirrored by `KEY_COMBINATIONS` in the
 * runtime. None collides with macOS's own screenshot shortcuts.
 */
export const SNAPSHOT_KEY_COMBINATIONS = [
  'Command+Shift+2',
  'Control+Shift+2',
  'Option+Shift+2',
] as const;
export type SnapshotKeyCombination = (typeof SNAPSHOT_KEY_COMBINATIONS)[number];

/**
 * `bothShift` (left and right Shift together) and key combinations need no
 * keyboard permission. `doubleShift` listens to key events, which macOS gates
 * behind Input Monitoring.
 */
export type SnapshotShortcut =
  | { kind: 'bothShift' }
  | { kind: 'doubleShift' }
  | { kind: 'keyCombination'; accelerator: SnapshotKeyCombination };

export interface SnapshotSettings {
  enabled: boolean;
  shortcut: SnapshotShortcut;
  captureMode: 'activeWindow' | 'region' | 'fullScreen';
  afterCapture: 'stage' | 'save' | 'clipboard';
  flash: boolean;
  sound: boolean;
  toast: boolean;
  copyToClipboard: boolean;
  retentionDays: 1 | 7 | 30;
}
export interface Snapshot {
  id: string;
  capturedAt: number;
  application: string;
  windowTitle: string;
  width: number;
  height: number;
  bytes: number;
  resourceId: string | null;
  note: string;
  sent: boolean;
  context: ContextItem;
}
export interface SnapshotRequestMap {
  'snapshot.list': { params: Record<string, never>; result: { snapshots: Snapshot[] } };
  'snapshot.settings.get': { params: Record<string, never>; result: SnapshotSettings };
  'snapshot.settings.update': { params: SnapshotSettings; result: SnapshotSettings };
  'snapshot.focus': { params: { resourceId: string }; result: { accepted: true } };
  'snapshot.stage': {
    params: { id: string; resourceId: string | null; note: string };
    result: Snapshot;
  };
  'snapshot.remove': { params: { id: string }; result: { accepted: true } };
  'snapshot.asset': { params: { id: string; thumbnail: boolean }; result: { dataUrl: string } };
  'snapshot.cleanup': { params: { all: boolean }; result: { removed: number } };
}
