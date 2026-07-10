import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent sessionKey → ACP sessionId map (`<configDir>/sessions.json`).
 *
 * Conversation context is meant to live forever — across daemon restarts — until the user
 * explicitly clears it (/new). The harness (e.g. Claude Code) already keeps the actual history
 * on its own disk; this store only remembers WHICH ACP session belongs to each session key, so
 * that after a restart agent-acp can `session/load` it into a fresh subprocess instead of
 * starting blank. /new deletes the entry.
 *
 * Write-through on every change; a missing/corrupt file degrades to empty (context loss, not a crash).
 */
export class SessionStore {
  private map = new Map<string, string>();

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') this.map.set(k, v);
    } catch {
      /* first run or corrupt file: start empty */
    }
  }

  get(sessionKey: string): string | undefined {
    return this.map.get(sessionKey);
  }

  set(sessionKey: string, acpSessionId: string): void {
    if (this.map.get(sessionKey) === acpSessionId) return;
    this.map.set(sessionKey, acpSessionId);
    this.flush();
  }

  delete(sessionKey: string): void {
    if (this.map.delete(sessionKey)) this.flush();
  }

  private flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map), null, 2) + '\n');
    } catch (e) {
      console.warn('[session-store] failed to persist the session map:', e instanceof Error ? e.message : e);
    }
  }
}
