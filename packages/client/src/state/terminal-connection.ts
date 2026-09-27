import { TERMINAL_LIMITS } from '@jam/protocol';
import type {
  JamTransport,
  TerminalAttachment,
  TerminalSession,
  TerminalStreamEvent,
} from '@jam/protocol';

/**
 * One terminal view's connection to its runtime session.
 *
 * It owns nothing but delivery: output goes straight to the screen, never
 * into React state; input is sent in order; closing detaches the view and
 * leaves the shell running. Only an explicit `terminal.kill` elsewhere ends a
 * shell, and this class never sends one.
 */

/** Whatever renders the terminal. xterm.js in the app; a stub in tests. */
export interface TerminalScreen {
  write(data: string, rendered: () => void): void;
  reset(): void;
}

export interface TerminalConnectionHandlers {
  /** The session started, resized or ended. Not called for output. */
  onSession(terminal: TerminalSession | undefined): void;
  onError(message: string): void;
}

/** Acknowledge rendered output in steps, not per chunk. */
export const ACK_EVERY = 32 * 1024;
/** Paste is split so each request stays well inside the input limit. */
export const INPUT_CHUNK = 16 * 1024;

/** Splits text without separating a surrogate pair. */
export function chunkInput(data: string, size = INPUT_CHUNK): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + size, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'The terminal could not be reached.';
const isConflict = (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict';

export class TerminalConnection {
  private attachment?: TerminalAttachment;
  /** From the snapshot, which can arrive before `attachTerminal` resolves. */
  private attachmentId?: string;
  private closed = false;
  private session: TerminalSession | undefined;
  private pendingInput = '';
  private sending = false;
  private wantedSize?: { cols: number; rows: number };
  private resizing = false;
  private renderedSeq = 0;
  private unacknowledged = 0;

  constructor(
    private readonly transport: JamTransport,
    readonly resourceId: string,
    private readonly screen: TerminalScreen,
    private readonly handlers: TerminalConnectionHandlers,
  ) {}

  get current() {
    return this.session;
  }

  async open() {
    try {
      const attachment = await this.transport.attachTerminal(this.resourceId, (event) =>
        this.receive(event),
      );
      if (this.closed) attachment.detach();
      else this.attachment = attachment;
    } catch (error) {
      if (!this.closed) this.handlers.onError(messageOf(error));
    }
  }

  private receive(event: TerminalStreamEvent) {
    if (this.closed) return;
    switch (event.type) {
      case 'snapshot':
        this.attachmentId = event.attachmentId;
        this.session = event.terminal;
        if (event.data) this.screen.write(event.data, () => {});
        this.handlers.onSession(event.terminal);
        this.flushResize();
        return;
      case 'output': {
        const { seq, data } = event;
        this.screen.write(data, () => this.rendered(seq, data.length));
        return;
      }
      case 'session': {
        const restarted = this.session && this.session.id !== event.terminal.id;
        // A new shell in the same resource starts on a clean screen.
        if (restarted) this.screen.reset();
        this.session = event.terminal;
        this.handlers.onSession(event.terminal);
        this.flushResize();
        return;
      }
    }
  }

  private rendered(seq: number, length: number) {
    if (this.closed || !this.attachmentId) return;
    this.renderedSeq = Math.max(this.renderedSeq, seq);
    this.unacknowledged += length;
    if (this.unacknowledged < ACK_EVERY) return;
    this.unacknowledged = 0;
    void this.transport
      .request('terminal.ack', { attachmentId: this.attachmentId, seq: this.renderedSeq })
      .catch(() => {
        // A detached view has nothing to acknowledge.
      });
  }

  /** Keyboard input and paste. Sent one request at a time, in order. */
  input(data: string) {
    if (this.closed || !data || this.session?.status !== 'running') return;
    this.pendingInput += data;
    void this.flushInput();
  }

  private async flushInput() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pendingInput && !this.closed) {
        const [chunk] = chunkInput(this.pendingInput);
        this.pendingInput = this.pendingInput.slice(chunk!.length);
        try {
          await this.transport.request('terminal.input', {
            resourceId: this.resourceId,
            data: chunk!,
          });
        } catch (error) {
          this.pendingInput = '';
          // The shell ended while typing; its exit is reported separately.
          if (!isConflict(error)) this.handlers.onError(messageOf(error));
        }
      }
    } finally {
      this.sending = false;
    }
  }

  /** The view's size in cells. Only the latest size is sent. */
  resize(cols: number, rows: number) {
    if (
      cols < TERMINAL_LIMITS.minCols ||
      rows < TERMINAL_LIMITS.minRows ||
      cols > TERMINAL_LIMITS.maxCols ||
      rows > TERMINAL_LIMITS.maxRows
    )
      return;
    this.wantedSize = { cols, rows };
    this.flushResize();
  }

  get size() {
    return this.wantedSize;
  }

  private flushResize() {
    const wanted = this.wantedSize;
    const session = this.session;
    if (this.closed || this.resizing || !wanted || session?.status !== 'running') return;
    if (session.cols === wanted.cols && session.rows === wanted.rows) return;
    this.resizing = true;
    void this.transport
      .request('terminal.resize', { resourceId: this.resourceId, ...wanted })
      .then(({ terminal }) => {
        if (!this.closed && this.session?.id === terminal.id) this.session = terminal;
      })
      .catch((error: unknown) => {
        if (!isConflict(error) && !this.closed) this.handlers.onError(messageOf(error));
      })
      .finally(() => {
        this.resizing = false;
        // Another size may have arrived while this one was in flight.
        const latest = this.wantedSize;
        if (latest && (latest.cols !== wanted.cols || latest.rows !== wanted.rows))
          this.flushResize();
      });
  }

  /** Detaches this view only. The shell keeps running. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.pendingInput = '';
    this.attachment?.detach();
    this.attachment = undefined;
  }
}
