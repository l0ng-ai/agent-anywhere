#!/usr/bin/env node
import { Command } from 'commander';
import { encode } from '@toon-format/toon';
import { runSetup } from './commands/setup.js';
import { runDoctor } from './commands/doctor.js';
import { runReverse } from './commands/reverse.js';
import { REVERSE_COMMANDS, CHANNEL_OPTION } from './ipc/commands.js';

// Note: the start path pulls in the heavy koishi + claude agent sdk stack, so it's
// lazy-loaded to keep --help / setup / doctor / reverse commands lightweight to start.
const runStart = () => import('./commands/start.js').then((m) => m.runStart());

const program = new Command();
program
  .name('agent-anywhere')
  .description('Gateway that connects IM platforms to coding agents: messaging via Koishi, handled over ACP')
  .version('0.2.0')
  // Global: pick a specific config file (e.g. one per platform). Default is ~/.config/agent-anywhere/config.yaml.
  // We stash it on process.env so it's inherited by the spawned agent — its reverse commands then resolve
  // the same config/socket. Only one daemon runs at a time, so the socket sits next to the chosen file.
  .option('-c, --config <path>', 'path to the config YAML to use (default: ~/.config/agent-anywhere/config.yaml)');

// Set the override before any subcommand action runs (setup/start/doctor/reverse all read it via configPath()).
program.hook('preAction', (thisCommand) => {
  const file = thisCommand.opts().config as string | undefined;
  if (file) process.env.AGENT_ANYWHERE_CONFIG_FILE = file;
});

// AXI §6: agents read stdout, not stderr. Commander writes usage/validation errors to stderr by
// default; route them to stdout so the agent that invoked a reverse command can see what went wrong.
program.configureOutput({ writeErr: (str) => process.stdout.write(str) });

// --- Management commands ---
program.command('setup').description('Interactive configuration wizard').action(runSetup);
// doctor is the default: running `agent-anywhere` with no args shows live state (AXI §8), and being
// read-only it's safe to trigger accidentally — unlike starting a daemon.
program
  .command('doctor', { isDefault: true })
  .description('Run environment self-checks (default when no command is given)')
  .option('--migrate-config', 'rewrite a v0 config file to the v1 `platforms:` map format (backs up to config.yaml.bak first)')
  .action((opts: { migrateConfig?: boolean }) => runDoctor({ migrateConfig: opts.migrateConfig }));
program.command('start').description('Start the daemon').action(runStart);

// --- Reverse commands (invoked by the agent via a skill; located by AGENT_ANYWHERE_TURN_TOKEN) ---
// All derived from the single REVERSE_COMMANDS source, keeping cli, skill hints, and IPC protocol consistent.
for (const spec of REVERSE_COMMANDS) {
  const cmd = program.command(spec.usage).description(spec.description);
  for (const opt of [...spec.options, CHANNEL_OPTION]) {
    if (opt.parse) cmd.option(opt.flags, opt.description ?? '', opt.parse);
    else cmd.option(opt.flags, opt.description ?? '');
  }
  // commander passes (positional..., options, command); take the last two as options/command.
  cmd.action((...args: unknown[]) => {
    args.pop(); // command object
    const opts = (args.pop() ?? {}) as Record<string, unknown>;
    const positionals = args as string[];
    return runReverse(spec.build(positionals, opts));
  });
}

program.parseAsync(process.argv).catch((e) => {
  // AXI §6: structured error on stdout (not stderr) so an invoking agent can read and act on it.
  console.log(encode({ error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
});
