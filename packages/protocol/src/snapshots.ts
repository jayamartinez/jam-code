import type { ContextItem } from './types';

export interface SnapshotSettings {
  enabled: boolean;
  shortcut: { kind: 'doubleShift' } | { kind: 'keyCombination'; accelerator: string };
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
