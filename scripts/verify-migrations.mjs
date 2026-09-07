import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'ledeger-migrations-'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(args) {
	const result = spawnSync(pnpm, ['exec', 'wrangler', ...args], {
		cwd: process.cwd(),
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, CI: '1' },
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
	const common = ['d1', 'migrations', 'apply', 'ledeger-db', '--local', '--persist-to', persistTo];
	run(common);
	run(common);
	console.log('D1 migrations applied successfully and are idempotent.');
} finally {
	fs.rmSync(persistTo, { recursive: true, force: true });
}
