# 0001 — Runtime owned domain, replaceable clients

Status: accepted for foundation.

JAM Code needs native capabilities now and a possible web/phone client later. Putting Tauri calls in product components would couple the product to one host. Choose a shared client and platform-neutral protocol, one Rust runtime crate, and a thin Tauri host/transport. Native services stay behind the runtime. This adds a small explicit serialization boundary and contract-test obligation. It avoids premature independent crates and a remote server. Revisit physical splits only when ownership/build boundaries justify them.
