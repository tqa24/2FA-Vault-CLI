/**
 * `2fav list [--filter <text>]`
 *
 * Calls `GET /api/v1/twofaccounts` and prints `service — account` per row.
 * The optional `--filter` performs a client-side case-insensitive substring
 * match against `service` or `account`.
 */

import { Command } from 'commander';
import { apiGet, CliError } from '../services/api.js';
import type { Account, AccountListResponse } from '../types.js';

export const listCommand = new Command('list')
    .description('List your 2FA accounts (service — account)')
    .option('--filter <text>', 'Case-insensitive substring filter on service or account')
    .action(async (opts: { filter?: string }) => {
        const body = await apiGet<AccountListResponse>('/twofaccounts?withOtp=0');
        const accounts = body?.data ?? [];

        const visible = opts.filter ? applyFilter(accounts, opts.filter) : accounts;
        if (visible.length === 0) {
            const suffix = opts.filter ? ` matching '${opts.filter}'` : '';
            throw new CliError(`No accounts found${suffix}.`);
        }

        for (const a of visible) {
            console.log(`[${a.id}] ${label(a)}`);
        }
        console.log(`\n${visible.length} account${visible.length === 1 ? '' : 's'}.`);
    });

/** Client-side filter on service or account (null-safe). */
function applyFilter(accounts: Account[], filter: string): Account[] {
    const q = filter.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
        const service = (a.service ?? '').toLowerCase();
        const account = (a.account ?? '').toLowerCase();
        return service.includes(q) || account.includes(q);
    });
}

/** Human-readable `service — account` label (null-safe). */
function label(a: Account): string {
    const service = a.service ?? '(no service)';
    const account = a.account ?? '';
    return account ? `${service} — ${account}` : service;
}
