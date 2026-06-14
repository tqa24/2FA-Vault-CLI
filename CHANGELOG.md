# Change log

All notable changes to the 2FA-Vault CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-14

Phase 1 MVP. API-only commands (no E2EE); OTPs are generated server-side.

### Added

- `2fav login --host <URL>`: prompts for a Personal Access Token (PAT), verifies it against `GET /api/v1/user`, and stores host + PAT in the OS keychain.
- `2fav logout`: removes stored credentials from the keychain (and the fallback file).
- `2fav list [--filter <text>]`: lists accounts as `[id] service — account`, with optional case-insensitive substring filter.
- `2fav get <service>`: prints the current one-time password for the matching account.
- `2fav copy <service>`: copies the current one-time password to the system clipboard.
- `2fav --version` / `2fav --help`: standard help and version output.
- Single-binary distribution via `bun build --compile` (Linux x64/arm64, macOS x64/arm64, Windows x64).
- OS keychain storage via `keytar` (macOS Keychain / Windows Credential Manager / libsecret on Linux), with a `0600` plaintext fallback at `~/.2fav/config.json` when no secret service is available.

### Security

- The PAT is stored in the OS keychain and never written to disk unencrypted unless the keychain is unavailable, in which case the fallback file is created with mode `0600` and a warning is printed.
- Phase 1 generates OTPs server-side; for an E2EE-enabled vault the server holds an opaque encrypted payload and cannot generate OTPs. Local vault unlock + client-side TOTP lands in Phase 2.
- No telemetry, no analytics.

### Notes

- Phase 2 (local E2EE unlock with Argon2id + AES-256-GCM mirroring `2FA-Vault/resources/js/services/crypto.js`, and client-side TOTP) is not yet implemented.
- CLI `bun test` suite is deferred.
