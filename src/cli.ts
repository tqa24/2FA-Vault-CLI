#!/usr/bin/env bun
/**
 * 2FA-Vault CLI entry point.
 *
 * Wires the commander program, registers every Phase 1 command, and installs a
 * single global error handler that prints human-readable messages to stderr and
 * exits with a non-zero code on failure (CI-friendly).
 *
 * Phase 1 scope: API-only commands (login, logout, list, get, copy).
 * Phase 2 (E2EE / local crypto) is intentionally NOT wired here yet.
 */

import { program, CommanderError } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { listCommand } from './commands/list.js';
import { getCommand } from './commands/get.js';
import { copyCommand } from './commands/copy.js';
import { CliError } from './services/api.js';

const VERSION = '0.1.0';

program
    .name('2fav')
    .version(VERSION, '-v, --version', 'Print the 2fav version')
    .description('2FA-Vault CLI — manage your two-factor accounts from the terminal');

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(listCommand);
program.addCommand(getCommand);
program.addCommand(copyCommand);

/**
 * Run the program and handle errors uniformly. Commander throws `CommanderError`
 * for usage mistakes (e.g. missing required argument); our own commands throw
 * `CliError` for runtime/API failures. Both must result in a clean stderr
 * message and a non-zero exit — never an unhandled stack trace.
 */
export async function run(argv: string[]): Promise<void> {
    try {
        await program.parseAsync(argv, { from: 'user' });
    } catch (err) {
        if (err instanceof CliError) {
            fail(err.message, err.exitCode);
        }
        if (err instanceof CommanderError) {
            // commander already printed its own message; just mirror the code.
            process.exit(err.exitCode);
        }
        const detail = err instanceof Error ? err.message : String(err);
        fail(`Unexpected error: ${detail}`);
    }
}

/** Print a message to stderr and exit with the given code. */
function fail(message: string, code = 1): never {
    process.stderr.write(`Error: ${message}\n`);
    process.exit(code);
}

await run(process.argv);
