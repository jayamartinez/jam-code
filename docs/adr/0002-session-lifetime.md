# 0002 — App-owned runtime, view-independent sessions

Status: accepted for foundation.

Pane unmount cannot be a process lifecycle event. Rust owns sessions/tasks; views hold resource IDs. The Tauri process remains while the window is hidden via a usable tray/reopen path. Explicit Quit interrupts active tasks and exits. Restart restores durable history and marks interrupted work honestly. This is lighter and operationally simpler than an always-running daemon. It does not survive process crash or OS logout. A separate runtime host remains possible without moving ownership back into React.

The desktop single-instance guard runs before runtime/database initialization; subsequent launches focus the existing window. Closing or reloading that WebView detaches subscriptions only. Explicit Quit uses one two-second task shutdown deadline and records interrupted tool activity. A future standalone or remote host must establish exclusive database/process ownership before recovery; the runtime crate does not yet provide a cross-process ownership lock itself.
