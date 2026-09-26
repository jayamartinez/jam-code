# 0005 — Stable tooling with a supported TypeScript parser

Status: accepted for foundation.

Package registries were checked during implementation on 2026-09-25. Use stable React 19.3, Vite 8.3, Tailwind 4.3, Vitest 5, ESLint 10, pnpm 12 and Tauri 2.11. Avoid prerelease Tauri 3. Pin direct dependencies and commit lockfiles when the developer approves shipping.

TypeScript 7.0.2 is available, but the current typescript-eslint 8.70.1 declares support below 6.1. Pin TypeScript 6.0.3 to keep the compiler and lint parser in a supported combination. Revisit this compatibility exception when the parser supports 7. Node 22.13+ satisfies Vite, Vitest and ESLint; the observed development host is Node 22.19.0. No global tool upgrades are required. A broken host pnpm shim can be bypassed with `npm exec --yes --package=pnpm@12.6.0 -- pnpm <command>`.
