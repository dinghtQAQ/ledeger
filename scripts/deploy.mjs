import { spawnSync } from 'node:child_process';
import path from 'node:path';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = process.argv.slice(2);
const dryRun = args[0] === '--dry-run';
const wranglerArgs = dryRun ? args.slice(1) : args;
const configIndex = wranglerArgs.indexOf('--config');
const configPath = configIndex >= 0 && wranglerArgs[configIndex + 1] ? wranglerArgs[configIndex + 1] : 'wrangler.jsonc';
const production = path.basename(configPath).includes('production');
const env = { ...process.env, ...(production ? { RELEASE_ENV: 'production' } : {}) };

function run(commandArgs) {
	const result = spawnSync(pnpm, commandArgs, { stdio: 'inherit', shell: process.platform === 'win32', env });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['run', 'build']);
run(['exec', 'node', 'scripts/verify-release-gates.mjs', '--config', configPath]);
run(['exec', 'wrangler', 'deploy', ...(dryRun ? ['--dry-run'] : []), ...wranglerArgs]);
