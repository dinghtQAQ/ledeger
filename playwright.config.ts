import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const workerPort = 8787;
const turnstilePort = 8790;
const persistDirectory = path.resolve('.wrangler', 'browser-tests', String(process.pid));

export default defineConfig({
	testDir: './test/browser',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
	use: {
		baseURL: `http://127.0.0.1:${workerPort}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		...devices['Desktop Chrome'],
	},
	webServer: [
		{
			command: `node test/turnstile-stub.mjs`,
			url: `http://127.0.0.1:${turnstilePort}/health`,
			env: { PORT: String(turnstilePort) },
			timeout: 30_000,
			reuseExistingServer: false,
		},
		{
			command: `pnpm exec wrangler d1 migrations apply ledeger-db --local --persist-to "${persistDirectory}" && pnpm run build && pnpm exec wrangler dev --local --port ${workerPort} --show-interactive-dev-session false --persist-to "${persistDirectory}" --var LEDGER_PASSWORD:test-password --var TURNSTILE_SECRET_KEY:test-turnstile-secret --var TURNSTILE_VERIFY_URL:http://127.0.0.1:${turnstilePort}/siteverify --var LEDGER_TIMEZONE:Asia/Shanghai`,
			url: `http://127.0.0.1:${workerPort}/health`,
			timeout: 120_000,
			reuseExistingServer: false,
		},
	],
});
