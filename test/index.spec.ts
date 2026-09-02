import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const TEST_ENV = {
	...env,
	LEDGER_API_KEY: 'test-key',
	LEDGER_PASSWORD: 'test-password',
	TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
	LEDGER_TIMEZONE: 'Asia/Shanghai',
};

async function request(path: string, init: RequestInit = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new IncomingRequest(`https://example.com${path}`, init as any), TEST_ENV, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function createEntry(overrides: Record<string, unknown> = {}, key = crypto.randomUUID()) {
	const response = await request('/entries', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer test-key',
			'Content-Type': 'application/json',
			'Idempotency-Key': key,
		},
		body: JSON.stringify({
			type: 'expense',
			amount: '10.0000',
			occurredAt: '2026-09-01T01:02:03Z',
			category: 'food',
			note: 'test',
			...overrides,
		}),
	});
	return { response, body: await response.json<any>() };
}

describe('Hono worker', () => {
	beforeAll(async () => {
		await env.DB.prepare('DROP TABLE IF EXISTS entries').run();
		await env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS entries (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'due_expense')),
				amount_units TEXT NOT NULL,
				occurred_at TEXT NOT NULL,
				due_at TEXT,
				due_status TEXT,
				category TEXT,
				note TEXT,
				is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
				reversal_of TEXT UNIQUE,
				reversed_at TEXT,
				version INTEGER NOT NULL DEFAULT 1,
				idempotency_key TEXT UNIQUE,
				idempotency_payload TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (reversal_of) REFERENCES entries(id),
				CHECK (
					(type = 'due_expense' AND due_at IS NOT NULL AND due_status IN ('unpaid', 'paid', 'cancelled'))
					OR (type != 'due_expense' AND due_at IS NULL AND due_status IS NULL)
				)
			)`,
		).run();
		await env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS auth_sessions (
				token_hash TEXT PRIMARY KEY,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL
			)`,
		).run();
	});

	 beforeEach(async () => {
		await env.DB.prepare('DELETE FROM entries').run();
		await env.DB.prepare('DELETE FROM auth_sessions').run();
		await env.DB.prepare('DELETE FROM fine_categories').run().catch(() => undefined);
		await env.DB.prepare("INSERT INTO ledger_settings (id, payday_day, updated_at) VALUES (1, 20, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payday_day = 20, updated_at = CURRENT_TIMESTAMP").run().catch(() => undefined);
	});

	it('logs in with password and Turnstile, reports the session, and slides expiry', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		const login = await request('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
			body: JSON.stringify({ password: 'test-password', turnstileToken: 'token' }),
		});
		expect(login.status).toBe(200);
		expect(login.headers.get('set-cookie')).toContain('HttpOnly');
		expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
		const cookie = login.headers.get('set-cookie')!.split(';')[0];
		const first = await request('/auth/session', { headers: { Cookie: cookie } });
		const firstBody = await first.json<any>();
		expect(firstBody.authenticated).toBe(true);
		const originalExpiry = firstBody.expiresAt;
		await new Promise((resolve) => setTimeout(resolve, 2));
		const second = await request('/auth/session', { headers: { Cookie: cookie } });
		expect((await second.json<any>()).expiresAt).not.toBe(originalExpiry);
		expect(second.headers.get('set-cookie')).toContain('Max-Age=604800');
		fetchMock.mockRestore();
	});

	it('returns a generic login failure and rate limits repeated attempts', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		for (let index = 0; index < 5; index += 1) {
			const response = await request('/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: 'wrong', turnstileToken: 'token' }),
			});
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: { message: 'authentication failed' } });
		}
		const limited = await request('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: 'test-password', turnstileToken: 'token' }),
		});
		expect(limited.status).toBe(429);
		fetchMock.mockRestore();
	});

	it('expires and logs out a browser session, and blocks cross-origin writes', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
		const login = await request('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.3' },
			body: JSON.stringify({ password: 'test-password', turnstileToken: 'token' }),
		});
		const cookie = login.headers.get('set-cookie')!.split(';')[0];
		const tokenHash = await (async () => {
			const raw = cookie.split('=')[1];
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
			let binary = '';
			for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
			return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		})();
		const expired = new Date(Date.now() - 1000).toISOString();
		await env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?').bind(expired, tokenHash).run();
		expect((await (await request('/auth/session', { headers: { Cookie: cookie } })).json<any>()).authenticated).toBe(false);
		const logout = await request('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.com' } });
		expect(logout.status).toBe(204);
		const secondLogin = await request('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.4' },
			body: JSON.stringify({ password: 'test-password', turnstileToken: 'token' }),
		});
		const secondCookie = secondLogin.headers.get('set-cookie')!.split(';')[0];
		const crossOrigin = await request('/entries', {
			method: 'POST',
			headers: {
				Cookie: secondCookie,
				Origin: 'https://attacker.example',
				'Content-Type': 'application/json',
				'Idempotency-Key': 'cross-origin',
			},
			body: JSON.stringify({ type: 'expense', amount: '1', occurredAt: '2026-09-01T00:00:00Z', category: 'food' }),
		});
		expect(crossOrigin.status).toBe(403);
		vi.restoreAllMocks();
	});
	it('responds with Hello World! from the root route', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it('returns a JSON health response', async () => {
		const response = await SELF.fetch('https://example.com/health');
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('serves OpenAPI JSON and interactive docs publicly', async () => {
		const spec = await request('/openapi.json');
		expect(spec.status).toBe(200);
		const specBody = await spec.json<any>();
		expect(specBody.paths['/entries'].post).toBeTruthy();
		expect(specBody.paths['/entries'].post.parameters[0].name).toBe('Idempotency-Key');
		expect(specBody.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
		const docs = await request('/docs');
		expect(docs.status).toBe(200);
		expect(docs.headers.get('content-type')).toContain('text/html');
	});

	it('checks the D1 binding', async () => {
		const response = await SELF.fetch('https://example.com/health/db');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('creates an income with exact four-decimal storage and three-decimal display', async () => {
		const response = await request('/entries', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer test-key',
				'Content-Type': 'application/json',
				'Idempotency-Key': 'create-income-1',
			},
			body: JSON.stringify({
				type: 'income',
				amount: '100.0016',
				occurredAt: '2026-09-01T01:02:03Z',
				category: 'salary',
				note: 'September salary',
			}),
		});

		expect(response.status).toBe(201);
		const body = await response.json<{
			entry: { amount: string; displayAmount: string; type: string };
		}>();
		expect(body.entry).toMatchObject({
			type: 'income',
			amount: '100.0016',
			displayAmount: '100.002',
		});
	});

	it('rejects business requests without the configured bearer key', async () => {
		const response = await request('/entries');
		expect(response.status).toBe(403);
	});

	it('is idempotent and rejects reusing a key for a different payload', async () => {
		const first = await createEntry({ amount: '12.34567' }, 'idem-1');
		const retry = await createEntry({ amount: '12.34567' }, 'idem-1');
		const conflict = await createEntry({ amount: '12.3456', note: 'different' }, 'idem-1');
		expect(first.response.status).toBe(201);
		expect(retry.response.status).toBe(200);
		expect(retry.body.entry.id).toBe(first.body.entry.id);
		expect(first.body.entry.amount).toBe('12.3457');
		expect(first.body.entry.displayAmount).toBe('12.346');
		expect(conflict.response.status).toBe(409);
	});

	it('canonicalizes idempotent payloads and rejects zero or numeric amounts', async () => {
		const first = await createEntry({ amount: '12.3400', note: 'same' }, 'idem-canonical');
		const retry = await request('/entries', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer test-key',
				'Content-Type': 'application/json',
				'Idempotency-Key': 'idem-canonical',
			},
			body: JSON.stringify({
				note: 'same',
				occurredAt: '2026-09-01T01:02:03+00:00',
				amount: '12.34',
				type: 'expense',
				category: 'food',
				ignored: 'field',
			}),
		});
		const zero = await createEntry({ amount: '0' }, 'zero-amount');
		const numeric = await createEntry({ amount: 12.34 }, 'numeric-amount');
		expect(first.response.status).toBe(201);
		expect(retry.status).toBe(200);
		expect((await retry.json<any>()).entry.id).toBe(first.body.entry.id);
		expect(zero.response.status).toBe(400);
		expect(numeric.response.status).toBe(400);
	});

	it('rejects dueAt on non-due entries', async () => {
		const response = await createEntry({ dueAt: '2026-09-30T00:00:00+08:00' }, 'invalid-due-at');
		expect(response.response.status).toBe(400);
	});

	it('rejects malformed dates and non-string metadata', async () => {
		const invalidDate = await createEntry({ occurredAt: '2026-02-30T01:02:03+00:00' }, 'invalid-occurred-at');
		const invalidCategory = await createEntry({ category: 42 }, 'invalid-category');
		const invalidNote = await createEntry({ note: { value: 'bad' } }, 'invalid-note');
		expect(invalidDate.response.status).toBe(400);
		expect(invalidCategory.response.status).toBe(400);
		expect(invalidNote.response.status).toBe(400);
	});

	it('creates and pays a due expense without creating a duplicate entry', async () => {
		const created = await createEntry({ type: 'due_expense', dueAt: '2026-09-30T00:00:00+08:00' });
		expect(created.response.status).toBe(201);
		expect(created.body.entry.dueStatus).toBe('unpaid');
		const paid = await request(`/entries/${created.body.entry.id}/pay`, { method: 'POST', headers: { Authorization: 'Bearer test-key' } });
		expect(paid.status).toBe(200);
		expect((await paid.json<any>()).entry.dueStatus).toBe('paid');
		const listed = await request('/entries', { headers: { Authorization: 'Bearer test-key' } });
		expect((await listed.json<any>()).items).toHaveLength(1);
	});

	it('cancels a due expense when reversing and does not allow payment afterward', async () => {
		const created = await createEntry({ type: 'due_expense', dueAt: '2026-09-30T00:00:00+08:00' }, 'reverse-due');
		const reversed = await request(`/entries/${created.body.entry.id}`, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer test-key' },
		});
		const paid = await request(`/entries/${created.body.entry.id}/pay`, { method: 'POST', headers: { Authorization: 'Bearer test-key' } });
		expect(reversed.status).toBe(200);
		expect((await reversed.json<any>()).entry.dueStatus).toBe('cancelled');
		expect(paid.status).toBe(409);
	});

	it('reverses exactly once with an equal amount and opposite type', async () => {
		const created = await createEntry({ type: 'expense', amount: '100.0016' });
		const reversed = await request(`/entries/${created.body.entry.id}`, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer test-key' },
		});
		expect(reversed.status).toBe(200);
		const body = await reversed.json<any>();
		expect(body.reversal.amount).toBe('100.0016');
		expect(body.reversal.type).toBe('income');
		expect(body.reversal.reversalOf).toBe(created.body.entry.id);
		expect(body.reversal.occurredAt).toBe(created.body.entry.occurredAt);
		expect(body.entry.reversedAt).toBeTruthy();
		const duplicate = await request(`/entries/${created.body.entry.id}`, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer test-key' },
		});
		expect(duplicate.status).toBe(409);
	});

	it('lists entries with cursor pagination and inclusive-exclusive date filters', async () => {
		await createEntry({ occurredAt: '2026-09-01T00:00:00+08:00', note: 'first' }, 'page-1');
		await createEntry({ occurredAt: '2026-09-01T12:00:00+08:00', note: 'second' }, 'page-2');
		await createEntry({ occurredAt: '2026-09-02T00:00:00+08:00', note: 'third' }, 'page-3');
		const first = await request('/entries?limit=1&from=2026-09-01&to=2026-09-02', { headers: { Authorization: 'Bearer test-key' } });
		const firstBody = await first.json<any>();
		expect(firstBody.items).toHaveLength(1);
		expect(firstBody.items[0].note).toBe('second');
		expect(firstBody.nextCursor).toBeTruthy();
		const second = await request(`/entries?limit=1&from=2026-09-01&to=2026-09-02&cursor=${encodeURIComponent(firstBody.nextCursor)}`, {
			headers: { Authorization: 'Bearer test-key' },
		});
		expect((await second.json<any>()).items[0].note).toBe('first');
	});

	it('validates pagination and calendar dates', async () => {
		const invalidLimit = await request('/entries?limit=abc', { headers: { Authorization: 'Bearer test-key' } });
		const invalidFrom = await request('/entries?from=2026-99-99', { headers: { Authorization: 'Bearer test-key' } });
		const invalidTo = await request('/entries?to=2026-02-29', { headers: { Authorization: 'Bearer test-key' } });
		expect(invalidLimit.status).toBe(400);
		expect(invalidFrom.status).toBe(400);
		expect(invalidTo.status).toBe(400);
	});

	it('reads seeded categories and maintains fine categories without physical deletion', async () => {
		const listed = await request('/categories', { headers: { Authorization: 'Bearer test-key' } });
		expect(listed.status).toBe(200);
		expect((await listed.json<any>()).coarseCategories).toEqual([
			{ id: 1, name: '住房' }, { id: 2, name: '餐饮' }, { id: 3, name: '交通' },
			{ id: 4, name: '公用' }, { id: 5, name: '健康' }, { id: 6, name: '娱乐' }, { id: 7, name: '投资' },
		]);
		const created = await request('/categories/fine', {
			method: 'POST',
			headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: '房租', coarseCategoryId: 1 }),
		});
		expect(created.status).toBe(201);
		const fine = await created.json<any>();
		expect(fine).toMatchObject({ name: '房租', coarseCategoryId: 1, isActive: true });
		const renamed = await request(`/categories/fine/${fine.id}`, {
			method: 'PATCH',
			headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: '房贷', sortOrder: 4 }),
		});
		expect((await renamed.json<any>()).name).toBe('房贷');
		const disabled = await request(`/categories/fine/${fine.id}/disable`, { method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com' } });
		expect((await disabled.json<any>()).isActive).toBe(false);
		const deleted = await request(`/categories/fine/${fine.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com' } });
		expect(deleted.status).toBe(409);
	});

	it('validates fine category ownership, inactive state, and payday boundaries', async () => {
		const created = await request('/categories/fine', {
			method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: '早餐', coarseCategoryId: 2 }),
		});
		const fine = await created.json<any>();
		const wrongParent = await createEntry({ categoryId: 1, subcategoryId: fine.id }, 'wrong-parent');
		expect(wrongParent.response.status).toBe(400);
		await request(`/categories/fine/${fine.id}/disable`, { method: 'POST', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com' } });
		const inactive = await createEntry({ categoryId: 2, subcategoryId: fine.id }, 'inactive-fine');
		expect(inactive.response.status).toBe(400);
		const missing = await createEntry({ category: null, categoryId: null }, 'missing-coarse');
		expect(missing.response.status).toBe(400);
		const income = await createEntry({ type: 'income', category: null, categoryId: null }, 'income-without-category');
		expect(income.response.status).toBe(201);
		const invalidLow = await request('/settings/ledger', { method: 'PUT', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ paydayDay: 0 }) });
		const invalidHigh = await request('/settings/ledger', { method: 'PUT', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ paydayDay: 29 }) });
		expect(invalidLow.status).toBe(400);
		expect(invalidHigh.status).toBe(400);
		const updated = await request('/settings/ledger', { method: 'PUT', headers: { Authorization: 'Bearer test-key', Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ paydayDay: 1 }) });
		expect(await updated.json<any>()).toMatchObject({ paydayDay: 1, timezone: 'Asia/Shanghai' });
	});
});
