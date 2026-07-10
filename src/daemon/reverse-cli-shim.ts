import fs from 'node:fs';
import path from 'node:path';
import { configDir } from '../config/load.js';

/**
 * Self-provisioned `agent-anywhere` shim for agent subprocesses.
 *
 * The reverse-command hint promises the agent that `agent-anywhere` is on PATH, but whether that
 * is true depends on how the daemon was launched: a global npm install puts it on PATH, while
 * `node dist/cli.js start` or a tsx dev run does not (and a service manager like launchd may strip
 * PATH entirely). Instead of gambling, the daemon writes a two-line shim that re-executes exactly
 * the runtime it is itself running as (execPath + execArgv + argv[1] — so a tsx dev daemon spawns
 * a tsx reverse CLI, a dist daemon spawns dist), and agent-acp prepends the shim dir to each agent
 * child's PATH. This also pins the agent to THIS daemon's version when a different global one exists.
 *
 * POSIX only for now; on win32 it returns null and the agent falls back to whatever PATH offers.
 */
export function ensureReverseCliShim(): string | null {
  if (process.platform === 'win32') return null;
  const dir = path.join(configDir(), 'bin');
  const shim = path.join(dir, 'agent-anywhere');
  const script = [
    '#!/bin/sh',
    `exec ${[process.execPath, ...process.execArgv, process.argv[1] ?? ''].filter(Boolean).map(shellQuote).join(' ')} "$@"`,
    '',
  ].join('\n');
  try {
    // Idempotent: rewrite only when the content drifts (entry moved, node upgraded).
    if (!fs.existsSync(shim) || fs.readFileSync(shim, 'utf8') !== script) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(shim, script, { mode: 0o755 });
    } else {
      fs.chmodSync(shim, 0o755);
    }
    return dir;
  } catch (e) {
    console.warn('[shim] failed to provision the reverse CLI shim:', e instanceof Error ? e.message : e);
    return null;
  }
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
