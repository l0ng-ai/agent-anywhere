import path from 'node:path';
import { loadConfig, resolveSocketPath, configDir } from '../config/load.js';
import { Daemon } from '../daemon/daemon.js';
import { createPlatformAdapters } from '../platform/platform-factory.js';
import { createAcpAgentFactory } from '../daemon/agent-acp.js';
import { SessionStore } from '../daemon/session-store.js';

/**
 * `agent-anywhere start` — default command. Read config -> build platform adapter + agent factory -> start the daemon.
 */
export async function runStart(): Promise<void> {
  // Long-running daemon backstop: an occasional network blip (e.g. a transient
  // discord.com TLS drop while sending a reaction) shouldn't crash the whole process.
  // Log and keep running; never exit.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason instanceof Error ? reason.stack ?? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err.stack ?? err.message);
  });

  const cfg = loadConfig();
  const socket = resolveSocketPath(cfg);

  // One adapter per configured platform instance; the daemon drives them all.
  const platforms = await createPlatformAdapters(cfg.platforms);
  // Conversation context outlives the daemon: the store remembers each session's ACP session id
  // so a restarted daemon resumes it via session/load; only /new (or /clear) forgets it.
  const store = new SessionStore(path.join(configDir(), 'sessions.json'));
  const agents = createAcpAgentFactory(cfg, socket, store);
  const daemon = new Daemon(cfg, platforms, agents, socket, store);

  await daemon.run();
  console.log(`🚀 Agent Anywhere daemon is running (socket: ${socket})`);

  // Don't register SIGINT/SIGTERM here: installSignalHandlers inside daemon.run()
  // already handles graceful shutdown (exit codes 130/143, cleanup, re-entrancy guard).
  // A second set here would conflict (double stop / inconsistent exit codes).
}
