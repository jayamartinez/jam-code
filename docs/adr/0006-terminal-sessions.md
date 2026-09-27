# 0006 — Runtime-owned terminal sessions

Status: accepted.

A terminal is a first-class resource whose shell is a real pseudo-terminal
owned by the runtime, never by a React component. Panes are views: closing
one, switching tabs, changing Single/Tiles or reloading the window detaches
presentation and leaves the shell running.

## Decision

- **PTY:** `portable-pty` 0.9 (wezterm's, MIT): `openpty` on macOS/Linux and
  ConPTY on Windows behind one API. The runtime crate still has no Tauri
  dependency.
- **Identity:** a terminal resource has a stable ID and is recorded like any
  other resource. Each shell start is a session with its own ID. A restart in
  the same resource starts a new session. `terminal.create` always makes a new
  resource, so any number of terminals run side by side; files, not terminals,
  are keyed by target.
- **Ownership:** `TerminalManager` owns every PTY. Only `terminal.kill`, the
  shell exiting by itself, or explicit Quit end a shell. Quit ends all shells;
  a crash or OS shutdown preserves nothing. Shells do not outlive the app.
- **Streaming:** output never enters the workspace event stream. A view calls
  `JamTransport.attachTerminal(resourceId)` and receives a snapshot (session
  and recent output), then ordered `output` and `session` events on its own
  channel. Detaching affects only that view. The desktop bridge uses one Tauri
  Channel per attachment.
- **Reattach:** each terminal keeps its last 512 KiB of output, trimmed at a
  line break, so a view that mounts later redraws the screen. Full-screen
  programs redraw on the resize that follows attachment.
- **Flow control:** each attachment acknowledges rendered output. When a view
  has more than 256 KiB unacknowledged, the reader pauses, so the PTY applies
  backpressure to the program as a real terminal does. The client acknowledges
  every 32 KiB after xterm has rendered.
- **Shell:** `$SHELL` as a login shell on macOS/Linux (falling back to zsh,
  bash, sh); PowerShell 7, then Windows PowerShell, then `cmd.exe` on Windows.
  `ShellSpec` and `Runtime::set_terminal_shell` are the hook for a future
  Settings preference. The wire protocol does not let a client choose the
  program.
- **Working directory:** the project's first recorded folder that exists, else
  the home directory, which the pane labels honestly. `terminal.create` also
  accepts an explicit absolute `cwd`.
- **Frontend:** xterm.js 6 with the fit, search and unicode11 addons, in a
  lazily loaded `TerminalView` chunk. `TerminalConnection` keeps delivery out
  of React state; the pane re-renders only when the session changes.

## Limits

At most 32 running terminals and 64 attached views; 64 KiB per input request
(larger pastes are split); 2–1000 columns and 1–500 rows; 5000 lines of xterm
scrollback per view. Terminal resources persist, but their shells do not: after
a restart a terminal offers **Start shell**. Recorded terminal resources are not
yet pruned.

## Security

A terminal runs what the user types, with the user's privileges, which is what
a terminal is. It adds no agent command execution: no provider or agent path
writes to a terminal, and terminal output is not sent anywhere but its views.
The two new IPC commands are declared in the app manifest and granted only to
the trusted local window. A future remote client must not receive
`terminal.*` without explicit authorization for local command execution.

## Deferred

Clickable links need a native opener with its own permission. Shell and font
preferences in Settings, OSC 7 working-directory tracking, terminal excerpts as
context, and layout persistence across restarts all build on this without
changing ownership.
