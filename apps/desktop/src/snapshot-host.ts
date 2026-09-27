import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SnapshotHost, SnapshotShortcutStatus } from '@jam/client';
import {
  PROTOCOL_VERSION,
  validateRequest,
  validateResponse,
  type JamTransport,
} from '@jam/protocol';

export function createSnapshotHost(): SnapshotHost {
  return {
    action: (action, id) => invoke<SnapshotShortcutStatus>('snapshot_host', { action, id }),
    subscribe: (listener) => listen('snapshots-changed', listener),
    onOpen: (listener) =>
      listen<{ id: string | null }>('snapshot-open', (event) => listener(event.payload.id)),
  };
}
export const snapshotToastTransport: Pick<JamTransport, 'request'> = {
  async request(method, params) {
    const request = validateRequest({ protocolVersion: PROTOCOL_VERSION, method, params });
    const response = await invoke('snapshot_toast_request', { request });
    return validateResponse(method, response);
  },
};
