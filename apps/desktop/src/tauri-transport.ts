import { Channel, invoke } from '@tauri-apps/api/core';
import {
  JAM_ERROR_CODES,
  JamError,
  PROTOCOL_VERSION,
  validateEvent,
  validateRequest,
  validateResponse,
  validateScope,
  validateTerminalEvent,
} from '@jam/protocol';
import type {
  JamErrorCode,
  JamEvent,
  JamTransport,
  RequestMap,
  RequestMethod,
  SubscriptionScope,
  TerminalAttachment,
  TerminalStreamEvent,
} from '@jam/protocol';

export interface NativeBridge {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  channel(listener: (payload: unknown) => void): unknown;
}

const nativeBridge: NativeBridge = {
  invoke,
  channel(listener) {
    const channel = new Channel<unknown>();
    channel.onmessage = listener;
    return channel;
  },
};

// Every code the runtime answers with keeps its own message. A shorter list
// here turned the rest (a refused image, a disabled provider, a missing
// project folder) into a generic failure.
const errorCodes = new Set<string>(JAM_ERROR_CODES);

function transportError(error: unknown): JamError {
  if (error instanceof JamError) return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    errorCodes.has(error.code)
  ) {
    return new JamError(error.code as JamErrorCode, error.message);
  }
  return new JamError('unavailable', 'The local runtime could not complete this request.');
}

/** Native serialization is isolated here; shared product code sees only JamTransport. */
export class TauriTransport implements JamTransport {
  constructor(private readonly bridge: NativeBridge = nativeBridge) {}

  async request<M extends RequestMethod>(
    method: M,
    params: RequestMap[M]['params'],
  ): Promise<RequestMap[M]['result']> {
    const request = validateRequest({ protocolVersion: PROTOCOL_VERSION, method, params });
    try {
      const result = await this.bridge.invoke('jam_request', { request });
      return validateResponse(method, result);
    } catch (error) {
      throw transportError(error);
    }
  }

  async subscribe(
    scope: SubscriptionScope,
    listener: (event: JamEvent) => void,
  ): Promise<() => void> {
    validateScope(scope);
    let active = true;
    const onEvent = this.bridge.channel((payload) => {
      if (!active) return;
      const event = validateEvent(payload);
      if (!scope.resourceId || scope.resourceId === event.resourceId) listener(event);
    });
    let subscriptionId: string;
    try {
      const result = await this.bridge.invoke('jam_subscribe', { scope, onEvent });
      if (typeof result !== 'string' || !result) {
        throw new JamError('invalid_response', 'The runtime returned an invalid subscription.');
      }
      subscriptionId = result;
    } catch (error) {
      active = false;
      throw transportError(error);
    }
    return () => {
      if (!active) return;
      active = false;
      // Ignore in-flight events immediately. Disposing a channel never interrupts a session.
      void this.bridge.invoke('jam_unsubscribe', { subscriptionId }).catch(() => {
        // The runtime also drops dead channels when their owning window is destroyed.
      });
    };
  }

  async attachTerminal(
    resourceId: string,
    listener: (event: TerminalStreamEvent) => void,
  ): Promise<TerminalAttachment> {
    if (typeof resourceId !== 'string' || !resourceId.trim() || resourceId.length > 128)
      throw new JamError('invalid_request', 'Invalid terminal resource.');
    let active = true;
    const onEvent = this.bridge.channel((payload) => {
      if (active) listener(validateTerminalEvent(payload));
    });
    let attachmentId: string;
    try {
      const result = await this.bridge.invoke('jam_terminal_attach', { resourceId, onEvent });
      if (typeof result !== 'string' || !result) {
        throw new JamError('invalid_response', 'The runtime returned an invalid attachment.');
      }
      attachmentId = result;
    } catch (error) {
      active = false;
      throw transportError(error);
    }
    return {
      id: attachmentId,
      detach: () => {
        if (!active) return;
        active = false;
        // Detaching a view never stops the shell.
        void this.bridge.invoke('jam_terminal_detach', { attachmentId }).catch(() => {
          // A reloaded or destroyed window detaches its views in the runtime too.
        });
      },
    };
  }
}
