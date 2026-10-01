# Releasing JAM Code

How to cut a release such as `v0.1.0-alpha`. Nothing here publishes anything
by itself: a tag builds installers and creates a **draft** GitHub prerelease,
and a maintainer publishes it by hand.

## Version

The app version lives in `apps/desktop/package.json`. Tauri reads it for the
bundles (`tauri.conf.json` → `"version": "../package.json"`) and Vite embeds it
for Settings → About. The root and package `package.json` files and the Cargo
workspace carry the same string; `tests/release-metadata.test.ts` fails when
they disagree. Versions are SemVer: `0.1.0-alpha`, then `0.1.0-alpha.2` or
`0.2.0-alpha`. Tags are the version with a `v`: `v0.1.0-alpha`.

## Artifacts

| Platform              | Built by                                                        | Published as                               |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Windows 11 x64        | `tauri build --bundles nsis`                                    | `JAM-Code_<version>_windows-x64-setup.exe` |
| macOS 14+ (universal) | `tauri build --target universal-apple-darwin --bundles app,dmg` | `JAM-Code_<version>_macos-universal.dmg`   |

`node scripts/collect-release.mjs <platform>` copies the installers out of
`target/**/release/bundle` under those names into `target/release-artifacts/`
with a SHA-256 line each; the release workflow joins them into
`SHA256SUMS.txt`. Build output is never committed.

The Windows installer is NSIS, per-user (no administrator prompt), and
installs WebView2 if it is missing. MSI is not built: WiX rejects a
non-numeric prerelease version such as `-alpha`.

## Signing

The alpha is intentionally shipped without code signing:

- **Windows:** the NSIS installer is unsigned. SmartScreen shows "Windows
  protected your PC"; users choose _More info → Run anyway_.
- **macOS:** the app is ad-hoc signed (`signingIdentity: "-"`) and not
  notarized. Gatekeeper blocks the first launch; users open the app once,
  then choose _Open Anyway_ in System Settings → Privacy & Security (on
  macOS 14, right-click → _Open_). If macOS reports the app as damaged,
  `xattr -dr com.apple.quarantine "/Applications/JAM Code.app"` clears the
  quarantine flag.

The README and the release notes give users the same instructions; keep the
three in step.

Signing is future work and nothing is configured for it. When it is taken up:
the release workflow already forwards the `APPLE_*` secrets Tauri reads for
Developer ID signing and notarization (they are unset today), and Windows
signing would be configured through `bundle.windows` in `tauri.conf.json`.

There is no auto-updater. Users download new versions from GitHub Releases.

## Checklist

1. `main` is green in CI (Web, and Rust on Windows and macOS).
2. Versions agree (`pnpm test` checks) and match the tag you will push.
3. `node scripts/third-party-notices.mjs` leaves `THIRD_PARTY_NOTICES.md`
   unchanged (CI checks with `--check`).
4. `.github/release-notes/v<version>.md` exists; the workflow uses it as the
   release body.
5. Hands-on pass on both platforms with a release build, following
   [VALIDATION.md → Release acceptance](VALIDATION.md#release-acceptance).
6. `git tag v<version> && git push origin v<version>`. The Release workflow
   validates, builds both platforms, checks the tag matches the version and
   creates a draft prerelease with the installers and `SHA256SUMS.txt`.
7. Download both installers from the draft, install them on clean machines
   and compare checksums.
8. Publish the draft. Nothing is public until this step.

To build locally instead:

```sh
pnpm install --frozen-lockfile
pnpm check && pnpm check:rust
pnpm --filter @jam/desktop tauri build --bundles nsis     # Windows
pnpm --filter @jam/desktop tauri build --target universal-apple-darwin --bundles app,dmg   # macOS
node scripts/collect-release.mjs windows-x64               # or macos-universal
```

The macOS universal build needs both Rust targets:
`rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

## Data and upgrades

User data lives in the platform application-data folder under the identifier
`dev.jamcode.desktop` (`%APPDATA%\dev.jamcode.desktop` on Windows,
`~/Library/Application Support/dev.jamcode.desktop` on macOS). The database is
`jam.sqlite`. Before a schema upgrade the app writes
`jam.sqlite.before-v<N>.bak` beside it; a build older than the database
refuses to open it rather than guessing. Never change the identifier: it would
strand every user's history. See ADR 0013.
