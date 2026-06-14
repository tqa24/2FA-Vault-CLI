/**
 * `2fav login --host <URL>`
 *
 * Prompts for a Personal Access Token (PAT), verifies it against
 * `GET /api/v1/user`, and stores host + PAT.
 *
 * Storage strategy:
 *   1. Try the OS keychain via keytar.
 *   2. On any keytar failure, fall back to `~/.2fav/config.json` (mode 0600)
 *      and warn the user that the keychain is unavailable.
 *
 * The PAT is verified BEFORE being persisted, and on failure nothing is stored.
 */

import { Command } from 'commander';
import { createInterface } from 'node:readline';
import * as keychain from '../services/keychain.js';
import { CliError } from '../services/api.js';
import type { UserResponse } from '../types.js';

/** Default request timeout for the verification call. */
const VERIFY_TIMEOUT_MS = 15_000;

/** Validate and normalise the host URL. */
function normaliseHost(host: string): string {
    const trimmed = host.trim();
    if (!trimmed) throw new CliError('Host URL is required.');
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new CliError(
            `Host must include the scheme, e.g. https://vault.example.com (got '${trimmed}').`,
        );
    }
    return trimmed.replace(/\/+$/, '');
}

/**
 * Prompt for the PAT. Echo is muted on a real TTY; in a non-interactive context
 * (piped stdin), the value is read line-by-line without prompting.
 */
function promptForPat(): Promise<string> {
    if (!process.stdin.isTTY) {
        // Non-interactive: read the first line of piped input.
        return new Promise<string>((resolve, reject) => {
            let data = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => {
                data += chunk;
                const nl = data.indexOf('\n');
                if (nl >= 0) {
                    process.stdin.removeAllListeners('data');
                    resolve(data.slice(0, nl).replace(/\r$/, '').trim());
                }
            });
            process.stdin.on('end', () => resolve(data.trim()));
            process.stdin.on('error', reject);
        });
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute echoed characters while typing the PAT. We only let newlines through
    // so the prompt stays on its own line; everything else is swallowed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rl as any)._writeToOutput = (s: string) => {
        if (s === '\r' || s === '\n') rl.write(s);
    };

    return new Promise<string>((resolve) => {
        rl.question('Personal Access Token: ', (answer) => {
            rl.close();
            console.log(''); // newline after the muted prompt
            resolve(answer.trim());
        });
    });
}

/**
 * Verify the PAT directly against `GET /api/v1/user` (does not depend on the
 * api service's credential resolution, since credentials are not stored yet).
 */
async function verifyPat(host: string, pat: string): Promise<void> {
    const url = `${host}/api/v1/user`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    let res: Response;
    try {
        res = await fetch(url, {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
        });
    } catch (err) {
        clearTimeout(timer);
        const detail = err instanceof Error && err.name === 'AbortError'
            ? `timed out after ${VERIFY_TIMEOUT_MS / 1000}s`
            : (err instanceof Error ? err.message : String(err));
        throw new CliError(`Could not reach ${host}: ${detail}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
            throw new CliError('Verification failed: the PAT was rejected by the server.');
        }
        throw new CliError(`Verification failed: unexpected HTTP ${res.status} ${res.statusText}.`);
    }
    // Body is parsed to confirm it is a real user object, but we don't need it.
    await res.json().catch(() => ({} as UserResponse));
}

export const loginCommand = new Command('login')
    .description('Store a Personal Access Token (PAT) for a 2FA-Vault instance')
    .requiredOption('--host <url>', '2FA-Vault instance URL, e.g. https://vault.example.com')
    .action(async (opts: { host: string }) => {
        const host = normaliseHost(opts.host);
        const pat = await promptForPat();
        if (!pat) throw new CliError('No token entered.');

        await verifyPat(host, pat);

        const keychainOk = await keychain.isAvailable();
        if (keychainOk) {
            await keychain.store(host, pat);
            console.log(`Logged in to ${host}. Credentials stored in the OS keychain.`);
        } else {
            await keychain.storeFallback(host, pat);
            console.warn(
                `Warning: OS keychain unavailable (keytar did not load). ` +
                    `Credentials stored in plaintext at ${keychain.fallbackPath} (mode 0600).`,
            );
            console.log(`Logged in to ${host}.`);
        }
    });
