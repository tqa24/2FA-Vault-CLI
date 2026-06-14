/**
 * `2fav copy <service>`
 *
 * Same lookup + OTP fetch as `get`, but writes the password to the system
 * clipboard instead of stdout. Prints a short confirmation on success.
 */

import { Command } from 'commander';
import { findUniqueAccount } from './get.js';
import { apiGet, CliError } from '../services/api.js';
import { copyToClipboard, clipboardBackendLabel } from '../services/clipboard.js';
import type { OtpResponse } from '../types.js';

export const copyCommand = new Command('copy')
    .description('Copy the current one-time password for an account to the clipboard')
    .argument('<service>', 'Service name (or account) to search for')
    .action(async (service: string) => {
        const account = await findUniqueAccount(service);

        const otp = await apiGet<OtpResponse>(`/twofaccounts/${account.id}/otp`);
        if (!otp?.password) {
            throw new Error('The server returned an OTP response without a password field.');
        }

        const ok = await copyToClipboard(otp.password);
        if (!ok) {
            throw new CliError(
                `Could not copy to clipboard. No clipboard tool was available ` +
                    `(looked for ${clipboardBackendLabel()}).`,
            );
        }
        console.log(
            `OTP copied to clipboard for ${account.service ?? account.account ?? 'account'}.`,
        );
    });
