/**
 * OS clipboard abstraction.
 *
 * Writes a string to the system clipboard by spawning the appropriate native
 * tool for the current platform:
 *   - macOS:      `pbcopy`
 *   - Windows:    `clip.exe`
 *   - Linux X11:  `xclip`, then `xsel`
 *   - Linux WL:   `wl-copy`
 *
 * The OTP payload is always a short, digits/alphanumeric-only string, so shell
 * injection is not a concern — but we still pass input via stdin rather than
 * argv to avoid quoting issues.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/** A command to invoke plus its argv, with the payload written to stdin. */
interface ClipboardCommand {
    cmd: string;
    args: string[];
}

/** Returns true when running under the Bun runtime. */
function isBun(): boolean {
    return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

/** Resolve the clipboard command for the current platform. */
function resolveCommand(): ClipboardCommand | null {
    const plat = platform();
    if (plat === 'darwin') return { cmd: 'pbcopy', args: [] };
    if (plat === 'win32') return { cmd: 'clip.exe', args: [] };
    // Linux / others: pick the first available tool.
    const candidates: ClipboardCommand[] = [
        { cmd: 'xclip', args: ['-selection', 'clipboard'] },
        { cmd: 'xsel', args: ['--clipboard', '--input'] },
        { cmd: 'wl-copy', args: [] },
    ];
    return candidates[0] ?? null;
}

/**
 * Write `text` to the clipboard.
 *
 * @returns `true` on success, `false` if no clipboard tool was available or it
 *          exited non-zero (the caller decides how loudly to complain).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    const spec = resolveCommand();
    if (!spec) return false;

    try {
        const code = await runWithStdin(spec.cmd, spec.args, text);
        return code === 0;
    } catch {
        // Try the remaining Linux fallbacks before giving up.
        for (const alt of linuxFallbacks()) {
            try {
                const code = await runWithStdin(alt.cmd, alt.args, text);
                if (code === 0) return true;
            } catch {
                /* try next */
            }
        }
        return false;
    }
}

/** Fallback list for Linux (excludes the already-tried primary). */
function linuxFallbacks(): ClipboardCommand[] {
    if (platform() === 'linux') {
        return [
            { cmd: 'xsel', args: ['--clipboard', '--input'] },
            { cmd: 'wl-copy', args: [] },
        ];
    }
    return [];
}

/** Spawn a process, write `input` to its stdin, and await the exit code. */
function runWithStdin(cmd: string, args: string[], input: string): Promise<number | null> {
    const bun = isBun();
    if (bun) {
        return runViaBun(cmd, args, input);
    }
    return runViaNodeChild(cmd, args, input);
}

/** Bun-native spawn path. */
async function runViaBun(cmd: string, args: string[], input: string): Promise<number | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunGlobal = (globalThis as any).Bun;
    const proc = BunGlobal.spawn({
        cmd: [cmd, ...args],
        stdin: 'pipe',
        stdout: 'ignore',
        stderr: 'ignore',
    });
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    await proc.exited;
    return proc.exitCode;
}

/** Node `child_process.spawn` fallback (used when not running under Bun). */
function runViaNodeChild(cmd: string, args: string[], input: string): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        child.on('error', reject);
        child.on('close', (code) => resolve(code));
        child.stdin.on('error', reject);
        child.stdin.end(input);
    });
}

/** Human-readable description of the active clipboard backend (for errors). */
export function clipboardBackendLabel(): string {
    const spec = resolveCommand();
    return spec ? spec.cmd : '<no clipboard tool found>';
}
