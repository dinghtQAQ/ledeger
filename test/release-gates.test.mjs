import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const testSiteKey = '1x00000000000000000000AA';

function runNode(script, args, env = {}) {
	return spawnSync(process.execPath, [script, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
}

test('production builds reject a missing or test Turnstile site key', () => {
	const missing = runNode('scripts/build.mjs', [], { RELEASE_ENV: 'production', VITE_TURNSTILE_SITE_KEY: '' });
	const testKey = runNode('scripts/build.mjs', [], { RELEASE_ENV: 'production', VITE_TURNSTILE_SITE_KEY: testSiteKey });
	assert.notEqual(missing.status, 0);
	assert.notEqual(testKey.status, 0);
	assert.match(`${missing.stdout}${missing.stderr}`, /non-test VITE_TURNSTILE_SITE_KEY/);
});

test('a production bundle contains the configured site key instead of the test key', () => {
	const productionKey = '0x4AAAAAAA-production';
	const build = runNode('scripts/build.mjs', [], { RELEASE_ENV: 'production', VITE_TURNSTILE_SITE_KEY: productionKey });
	assert.equal(build.status, 0, build.stderr);
	const bundle = fs.readdirSync(path.join(root, 'dist', 'assets')).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(root, 'dist', 'assets', name), 'utf8')).join('\n');
	assert.match(bundle, new RegExp(productionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	assert.doesNotMatch(bundle, new RegExp(testSiteKey));
});

test('release gates verify the production config and built SPA assets', () => {
	const build = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', 'build'], {
		cwd: root,
		stdio: 'ignore',
		shell: process.platform === 'win32',
	});
	assert.equal(build.status, 0);
	const result = runNode('scripts/verify-release-gates.mjs', ['--config', 'wrangler.production.example.jsonc'], {
		VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAA-production',
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /ASSETS/);
	const config = fs.readFileSync(path.join(root, 'wrangler.production.example.jsonc'), 'utf8');
	assert.match(config, /"directory": "\.\/dist"/);
	assert.match(config, /"binding": "ASSETS"/);
	assert.match(config, /"run_worker_first": true/);
});
