import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const production = process.env.RELEASE_ENV === 'production';
const configuredSiteKey = process.env.VITE_TURNSTILE_SITE_KEY?.trim();
const testSiteKey = '1x00000000000000000000AA';

if (production && (!configuredSiteKey || configuredSiteKey === testSiteKey)) {
	console.error('Production build requires a non-test VITE_TURNSTILE_SITE_KEY.');
	process.exit(1);
}

const result = spawnSync(pnpm, ['exec', 'vite', 'build'], {
	stdio: 'inherit',
	shell: process.platform === 'win32',
	env: { ...process.env, VITE_TURNSTILE_SITE_KEY: configuredSiteKey || testSiteKey },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
