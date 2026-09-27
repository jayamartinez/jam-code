import type { Resource } from './types';

/**
 * Terminal contract.
 *
 * A terminal *resource* has a stable ID and outlives its views. Each shell it
 * runs is a *session* with its own ID; a restart in the same resource starts a
 * new one. The runtime owns the process: attaching a view streams output to
 * it, and detaching never stops the shell. Only `terminal.kill`, the shell
 * exiting by itself, or quitting JAM ends it.
 */

export interface TerminalSession {
  id: string;
  resourceId: string;
  projectId: string;
  /** Absolute directory the shell started in, as reported by the runtime. */
  cwd: string;
  /** The same directory for display, with the home directory shown as `~`. */
  cwdLabel: string;
  /** `home` means the project records no folder JAM could use. */
  cwdSource: 'project' | 'requested' | 'home';
  shell: string;
  title: string;
  status: 'running' | 'exited';
  createdAt: string;
  cols: number;
  rows: number;
  exitCode?: number;
  exitSignal?: string;
  endedAt?: string;
  /** The shell ended because someone asked for it to be terminated. */
  terminated?: true;
}

export const TERMINAL_LIMITS = {
  /** Larger pastes are split by the client. */
  inputUtf16: 65_536,
  minCols: 2,
  maxCols: 1000,
  minRows: 1,
  maxRows: 500,
} as const;

export interface TerminalRequestMap {
  /** Creates a new terminal resource and starts its shell. */
  'terminal.create': {
    params: { projectId: string; cwd?: string; cols?: number; rows?: number };
    result: { resource: Resource; terminal: TerminalSession };
  };
  /** Starts a new shell in a terminal whose shell is not running. */
  'terminal.start': {
    params: { resourceId: string; cols?: number; rows?: number };
    result: { terminal: TerminalSession };
  };
  /** Absent when the resource has no shell in this runtime. */
  'terminal.get': { params: { resourceId: string }; result: { terminal?: TerminalSession } };
  'terminal.list': {
    params: { projectId?: string };
    result: { terminals: TerminalSession[] };
  };
  'terminal.input': { params: { resourceId: string; data: string }; result: { accepted: true } };
  'terminal.resize': {
    params: { resourceId: string; cols: number; rows: number };
    result: { terminal: TerminalSession };
  };
  /** Explicitly ends the shell. Closing a view never does this. */
  'terminal.kill': { params: { resourceId: string }; result: { terminal: TerminalSession } };
  /** Output up to `seq` has been rendered; paused output may continue. */
  'terminal.ack': { params: { attachmentId: string; seq: number }; result: { accepted: true } };
}

export type TerminalStreamEvent =
  /** Always first: the session, if any, and recent output to redraw. */
  | { type: 'snapshot'; attachmentId: string; terminal?: TerminalSession; data: string }
  | { type: 'output'; seq: number; data: string }
  /** The shell started, changed size or ended. */
  | { type: 'session'; terminal: TerminalSession };

export interface TerminalAttachment {
  readonly id: string;
  /** Stops delivery to this view. The shell keeps running. */
  detach(): void;
}
