/**
 * `2fav get <service> [--watch] [--copy]`
 *
 * Finds a single account by service/account name, then calls the server-side
 * OTP endpoint `GET /api/v1/twofaccounts/{id}/otp` and prints the password.
 *
 * - `--watch` refreshes the OTP at the start of each TOTP period (HOTP has no
 *   period, so --watch is disabled for HOTP with a note).
 * - `--copy` additionally writes the password to the system clipboard.
 * - E2EE accounts store a ciphertext secret the server cannot turn into an OTP;
 *   we detect them up front and emit a clear, actionable error.
 *
 * TODO(Phase 2): Add local E2EE decryption. When the vault is unlocked with a
 * cached master key, decrypt the account secret locally and compute the TOTP
 * client-side (mirrors resources/js/services/crypto.js) instead of asking the
 * server to generate the OTP.
 */

import { Command } from 'commander';
import { apiGet, CliError } from '../services/api.js';
import { copyToClipboard } from '../services/clipboard.js';
import type { Account, AccountListResponse, OtpResponse } from '../types.js';

interface GetOptions {
    watch?: boolean;
    copy?: boolean;
}

export const getCommand = new Command('get')
    .description('Print the current one-time password for an account')
    .argument('<service>', 'Service name (or account) to search for')
    .option('--watch', 'Refresh the OTP at the start of each TOTP period until interrupted')
    .option('--copy', 'Also copy the OTP to the system clipboard')
    .action(async (service: string, opts: GetOptions) => {
        const account = await findUniqueAccount(service);
        await assertNotEncrypted(account.id, service);

        await printOtp(account, opts);
        if (!opts.watch) return;

        // --watch is TOTP-only: HOTP has no period to align to.
        const period = await periodOf(account);
        if (!period) {
            console.error('note: --watch disabled for HOTP/period-less accounts.');
            return;
        }
        await watchLoop(account, period, opts);
    });

/** Fetch and print one OTP, copying to clipboard when requested. */
async function printOtp(account: Account, opts: GetOptions): Promise<void> {
    const otp = await fetchOtp(account.id);
    if (opts.copy) {
        await copyOrWarn(otp.password);
    }
    console.log(otp.password);
}

/** Re-fetch and print the OTP at each period boundary, indefinitely. */
async function watchLoop(account: Account, period: number, opts: GetOptions): Promise<void> {
    // align to the next period boundary before looping
    for (;;) {
        const sleepMs = period * 1000 - (Date.now() % (period * 1000));
        await sleep(sleepMs);
        await printOtp(account, opts);
    }
}

/** Resolve the TOTP period for an account, or null when there is none. */
async function periodOf(account: Account): Promise<number | null> {
    if (account.otp_type === 'hotp') return null;
    if (typeof account.period === 'number' && account.period > 0) return account.period;
    // Fall back to the period reported by a fresh OTP response.
    const otp = await fetchOtp(account.id);
    return typeof otp.period === 'number' && otp.period > 0 ? otp.period : null;
}

/** Fetch the current OTP for an account id. */
async function fetchOtp(id: number): Promise<OtpResponse> {
    const otp = await apiGet<OtpResponse>(`/twofaccounts/${id}/otp`);
    if (!otp?.password) {
        throw new Error('The server returned an OTP response without a password field.');
    }
    return otp;
}

async function copyOrWarn(password: string): Promise<void> {
    const ok = await copyToClipboard(password);
    if (!ok) console.error('warning: could not copy to clipboard (no clipboard tool available).');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find exactly one account whose `service` (or `account`) matches `query`
 * case-insensitively as a substring. Throws a `CliError` on no match or an
 * ambiguous match.
 */
export async function findUniqueAccount(query: string): Promise<Account> {
    const body = await apiGet<AccountListResponse>('/twofaccounts?withOtp=0');
    const accounts = body?.data ?? [];
    const needle = query.trim().toLowerCase();

    const matches = accounts.filter((a) => {
        const service = (a.service ?? '').toLowerCase();
        const account = (a.account ?? '').toLowerCase();
        return service.includes(needle) || account.includes(needle);
    });

    if (matches.length === 0) {
        throw new CliError(`No account matched '${query}'.`);
    }
    if (matches.length > 1) {
        const lines = matches.map((a) => `  [${a.id}] ${accountLabel(a)}`).join('\n');
        throw new CliError(
            `Multiple accounts matched '${query}':\n${lines}\nUse a more specific name.`,
        );
    }
    return matches[0];
}

/**
 * Fail fast with a clear message when the account uses E2EE. The server cannot
 * generate OTPs for E2EE secrets without the master password, which the CLI
 * never accepts (v1). We detect membership against the encrypted-accounts list.
 */
async function assertNotEncrypted(id: number, query: string): Promise<void> {
    const body = await apiGet<AccountListResponse>('/twofaccounts/encrypted');
    const encryptedIds = new Set((body?.data ?? []).map((a) => a.id));
    if (encryptedIds.has(id)) {
        throw new CliError(
            `'${query}' uses E2EE — the server cannot generate its OTP. ` +
                'CLI v1 supports non-E2EE vaults only.',
        );
    }
}

/** Human-readable `service — account` label (null-safe). */
function accountLabel(a: Account): string {
    const service = a.service ?? '(no service)';
    const account = a.account ?? '';
    return account ? `${service} — ${account}` : service;
}
