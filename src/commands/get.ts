/**
 * `2fav get <service>`
 *
 * Finds a single account by service name, then calls the server-side OTP
 * endpoint `GET /api/v1/twofaccounts/{id}/otp` and prints the password.
 *
 * TODO(Phase 2): Add local E2EE decryption. When the vault is unlocked with a
 * cached master key, decrypt the account secret locally and compute the TOTP
 * client-side (mirrors resources/js/services/crypto.js) instead of asking the
 * server to generate the OTP. For Phase 1 we rely entirely on server-side OTP
 * generation, which is correct for non-E2EE vaults and PAT-only auth.
 */

import { Command } from 'commander';
import { apiGet, CliError } from '../services/api.js';
import type { Account, AccountListResponse, OtpResponse } from '../types.js';

export const getCommand = new Command('get')
    .description('Print the current one-time password for an account')
    .argument('<service>', 'Service name (or account) to search for')
    .action(async (service: string) => {
        const account = await findUniqueAccount(service);

        const otp = await apiGet<OtpResponse>(`/twofaccounts/${account.id}/otp`);
        if (!otp?.password) {
            throw new Error('The server returned an OTP response without a password field.');
        }

        // Print only the password so the value is pipe-friendly (no label).
        console.log(otp.password);
    });

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

/** Human-readable `service — account` label (null-safe). */
function accountLabel(a: Account): string {
    const service = a.service ?? '(no service)';
    const account = a.account ?? '';
    return account ? `${service} — ${account}` : service;
}
