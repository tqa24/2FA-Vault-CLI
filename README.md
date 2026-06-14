# 2FA-Vault CLI

A command-line client for [2FA-Vault](../2FA-Vault). Manage your two-factor
authentication accounts from the terminal — list accounts, fetch a one-time
password, copy it to the clipboard.

This is the **Phase 1 MVP**: API-only commands. End-to-end-encryption (local
vault unlock and client-side TOTP) lands in Phase 2.

- **Runtime:** [Bun](https://bun.sh) (TypeScript)
- **Single binary:** `bun build --compile` produces a standalone executable per platform
- **Secure storage:** PAT stored in the OS keychain (macOS Keychain / Windows Credential Manager / libsecret on Linux), with a plaintext fallback (`~/.2fav/config.json`, mode `0600`) when the keychain is unavailable

## Install

### From a release binary

Download the binary for your platform from the latest
[GitHub Release](../../releases) and put it on your `PATH`. Rename it to `2fav`
(or `2fav.exe` on Windows).

### From source

```bash
git clone <repo-url> 2FA-Vault-CLI
cd 2FA-Vault-CLI
bun install
bun run build           # produces dist/2fav
```

For cross-compiled binaries (no local toolchain needed):

```bash
bun run build:linux-x64
bun run build:darwin-arm64
bun run build:win-x64
# (see package.json for all targets)
```

### Prerequisites

- A running 2FA-Vault instance
- A **Personal Access Token (PAT)** with access to the `twofaccounts` scope.
  Create one from your 2FA-Vault user settings.
- On Linux, the OS keychain requires a running secret service
  (`gnome-keyring`, `KWallet`, or `keepassxc`). Without one, the CLI falls back
  to the plaintext config file and prints a warning.
- The `copy` command needs a clipboard helper: `pbcopy` (macOS), `clip.exe`
  (Windows), or `xclip` / `xsel` / `wl-copy` (Linux).

## Usage

```bash
2fav login --host https://vault.example.com
# Personal Access Token: ********
# Logged in to https://vault.example.com. Credentials stored in the OS keychain.

2fav list
# [1] GitHub — alice@example.com
# [2] GitLab — alice
# 2 accounts.

2fav list --filter git
2fav get github
# 045698

2fav copy github
# OTP copied to clipboard for GitHub.

2fav logout
# Logged out. Stored credentials removed.
```

## Commands

| Command | Description |
| --- | --- |
| `2fav login --host <URL>` | Prompt for a PAT, verify it, and store host + PAT in the OS keychain (plaintext fallback otherwise). |
| `2fav logout` | Remove stored credentials from the keychain and the fallback file. |
| `2fav list [--filter <text>]` | List accounts as `[id] service — account`. `--filter` is a case-insensitive substring match on service or account. |
| `2fav get <service>` | Print the current one-time password for the matching account (server-side OTP). |
| `2fav copy <service>` | Copy the current one-time password to the system clipboard. |
| `2fav --version` / `2fav --help` | Standard help and version output. |

`<service>` matches case-insensitively as a substring of either the service or
the account label. If more than one account matches, the CLI lists the matches
and asks you to be more specific — it never silently picks one.

## API contract

The CLI talks to the standard 2FA-Vault REST API (see
[`2FA-Vault-API`](../2FA-Vault-API)):

- `GET /api/v1/user` — verifies the PAT during `login`.
- `GET /api/v1/twofaccounts` — lists accounts (`{ data: [ { id, service, account, ... } ] }`).
- `GET /api/v1/twofaccounts/{id}/otp` — returns `{ password, otp_type, generated_at, ... }`.

All requests send `Authorization: Bearer <PAT>` and `Accept: application/json`.

## Security notes

- The PAT is stored in the OS keychain and never written to disk unencrypted
  unless the keychain is unavailable (in which case the plaintext fallback is
  created with mode `0600` and a warning is printed).
- Phase 1 generates OTPs **server-side**. With an E2EE-enabled vault, the
  server holds an opaque encrypted payload and cannot generate OTPs — Phase 2
  adds local vault unlock for that case.
- No telemetry, no analytics.

## License

MIT.
