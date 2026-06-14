/**
 * Keychain abstraction for storing the 2FA-Vault PAT + host.
 *
 * Primary store: the OS keychain via `keytar`
 *   - macOS Keychain
 *   - Windows Credential Manager
 *   - libsecret / GNOME Keyring / KWallet on Linux
 *
 * Fallback store: a JSON file at `~/.2fav/config.json` (mode 0600) when keytar
 * is unavailable at runtime (e.g. headless Linux without a secret service, or
 * a `bun build --compile` binary where the native binding did not bundle).
 *
 * The account key used inside the keychain is the host URL, so a user can hold
 * credentials for multiple instances simultaneously.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import type { ApiConfig } from '../types.js';

/** Service name presented to the OS keychain. */
export const KEYCHAIN_SERVICE = '2FA-Vault-CLI';

const FALLBACK_DIR = join(homedir(), '.2fav');
const FALLBACK_FILE = join(FALLBACK_DIR, 'config.json');
const FALLBACK_MODE = 0o600;

/** Lazily-imported keytar handle (may fail to load). */
let keytarModule: typeof import('keytar') | null | undefined;

/**
 * Import keytar lazily so a missing/broken native binding never crashes the
 * whole CLI at import time — it just forces the fallback store.
 */
async function loadKeytar(): Promise<typeof import('keytar') | null> {
    if (keytarModule !== undefined) return keytarModule;
    try {
        // Dynamic import so `bun build --compile` and environments without the
        // native binding still boot.
        keytarModule = await import('keytar');
        return keytarModule;
    } catch {
        keytarModule = null;
        return null;
    }
}

/** Returns true when the OS keychain is usable in this environment. */
export async function isAvailable(): Promise<boolean> {
    const keytar = await loadKeytar();
    return keytar !== null;
}

/**
 * Store PAT + host in the OS keychain. Throws only on a hard keytar failure;
 * callers should catch and route to the plaintext fallback explicitly via
 * {@link storeFallback}.
 */
export async function store(host: string, pat: string): Promise<void> {
    const keytar = await loadKeytar();
    if (!keytar) {
        throw new Error('keychain unavailable');
    }
    await keytar.setPassword(KEYCHAIN_SERVICE, host, JSON.stringify({ host, pat }));
}

/**
 * Read credentials for the given host. When `host` is omitted, returns the
 * first stored credential set (single-instance convenience).
 */
export async function get(host?: string): Promise<ApiConfig | null> {
    const keytar = await loadKeytar();
    if (!keytar) return null;

    if (host) {
        const raw = await keytar.getPassword(KEYCHAIN_SERVICE, host);
        return raw ? parseConfig(raw) : null;
    }

    // No host specified: return the first matching credential.
    const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
    for (const c of creds) {
        const parsed = parseConfig(c.password);
        if (parsed) return parsed;
    }
    return null;
}

/** Remove the credential for a host (or all of them when host is omitted). */
export async function remove(host?: string): Promise<void> {
    const keytar = await loadKeytar();
    if (!keytar) return;

    if (host) {
        await keytar.deletePassword(KEYCHAIN_SERVICE, host);
        return;
    }
    const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
    for (const c of creds) {
        await keytar.deletePassword(KEYCHAIN_SERVICE, c.account);
    }
}

function parseConfig(raw: string): ApiConfig | null {
    try {
        const obj = JSON.parse(raw) as Partial<ApiConfig>;
        if (typeof obj.host === 'string' && typeof obj.pat === 'string') {
            return { host: obj.host, pat: obj.pat };
        }
    } catch {
        /* not JSON — ignore */
    }
    return null;
}

// ---- Plaintext fallback store (~/.2fav/config.json, mode 0600) ----

export async function fallbackExists(): Promise<boolean> {
    try {
        await stat(FALLBACK_FILE);
        return true;
    } catch {
        return false;
    }
}

export async function storeFallback(host: string, pat: string): Promise<void> {
    await mkdir(FALLBACK_DIR, { recursive: true });
    const payload: ApiConfig = { host, pat };
    await writeFile(FALLBACK_FILE, JSON.stringify(payload, null, 2), { mode: FALLBACK_MODE });
    // Re-assert 0600 in case the file already existed with looser bits.
    await chmod(FALLBACK_FILE, FALLBACK_MODE);
}

export async function getFallback(): Promise<ApiConfig | null> {
    try {
        const raw = await readFile(FALLBACK_FILE, 'utf8');
        const obj = JSON.parse(raw) as Partial<ApiConfig>;
        if (typeof obj.host === 'string' && typeof obj.pat === 'string') {
            return { host: obj.host, pat: obj.pat };
        }
        return null;
    } catch {
        return null;
    }
}

export async function removeFallback(): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(FALLBACK_FILE, { force: true });
}

export { FALLBACK_FILE as fallbackPath };
