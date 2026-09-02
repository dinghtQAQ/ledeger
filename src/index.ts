import { swaggerUI } from '@hono/swagger-ui';
import type { Context } from 'hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { amountToUnits, displayAmount, normalizeAmount, unitsToAmount } from './money';
import {
	createEntrySchema,
	entryPageSchema,
	entryResponseSchema,
	errorSchema,
	healthSchema,
	authLoginSchema,
	authSessionSchema,
	idParamSchema,
	listQuerySchema,
	reversalResponseSchema,
} from './schemas';
import { localDateToUtc } from './time';

type LedgerEnv = Env & {
	LEDGER_API_KEY?: string;
	LEDGER_PASSWORD?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SECRET?: string;
	LEDGER_TIMEZONE?: string;
	ASSETS?: { fetch: typeof fetch };
};
type LedgerContext = Context<{ Bindings: LedgerEnv }>;
type EntryType = 'income' | 'expense' | 'due_expense';
type DueStatus = 'unpaid' | 'paid' | 'cancelled';
type EntryRow = {
	id: string;
	type: EntryType;
	amount_units: string;
	occurred_at: string;
	due_at: string | null;
	due_status: DueStatus | null;
	category: string | null;
	note: string | null;
	is_reversal: number;
	reversal_of: string | null;
	reversed_at: string | null;
	version: number;
	created_at: string;
	updated_at: string;
};
type StoredEntryRow = EntryRow & { idempotency_payload: string | null };
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;
type Sort = keyof typeof sortMap;
type CursorContext = {
	sort: string;
	from: string | null;
	to: string | null;
	category: string | null;
};
type CursorPayload = { key: string; id: string; context: CursorContext };
type CreateEntryInput = {
	type: EntryType;
	amount: string;
	occurredAt: string;
	dueAt?: string;
	category?: string | null;
	note?: string | null;
};
type ListEntriesQuery = {
	cursor?: string;
	limit: number;
	from?: string;
	to?: string;
	category?: string;
	sort: Sort;
};

const sortMap = {
	'occurredAt.desc': 'occurred_at DESC, id DESC',
	'occurredAt.asc': 'occurred_at ASC, id ASC',
	'createdAt.desc': 'created_at DESC, id DESC',
	'amount.desc': 'CAST(amount_units AS INTEGER) DESC, id DESC',
	'amount.asc': 'CAST(amount_units AS INTEGER) ASC, id ASC',
} as const;

const SESSION_COOKIE = 'ledger_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_FAILURE_LIMIT = 5;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

const app = new OpenAPIHono<{ Bindings: LedgerEnv }>({
	defaultHook: (result, c) => {
		if (!result.success) return jsonError(c, 400, 'invalid request');
	},
});

const now = () => new Date().toISOString();

type AuthState = { authenticated: boolean; source: 'bearer' | 'session' | 'none'; expiresAt?: string };
type SessionRow = { token_hash: string; created_at: string; expires_at: string; last_seen_at: string };

async function ensureAuthTables(db: D1Database) {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS auth_sessions (
				token_hash TEXT PRIMARY KEY,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL
			)`,
		)
		.run();
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashToken(token: string) {
	return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function readCookie(request: Request, name: string) {
	const header = request.headers.get('Cookie');
	if (!header) return null;
	for (const part of header.split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return value.join('=') || null;
	}
	return null;
}

function sessionCookie(token: string, maxAge = SESSION_LIFETIME_MS / 1000) {
	return `${SESSION_COOKIE}=${token}; Max-Age=${Math.max(0, Math.floor(maxAge))}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function withCookie(response: Response, cookie: string) {
	const headers = new Headers(response.headers);
	headers.append('Set-Cookie', cookie);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function renewSessionCookie(c: LedgerContext, response: Response, auth: AuthState) {
	if (auth.source !== 'session') return response;
	const token = readCookie(c.req.raw, SESSION_COOKIE);
	return token ? withCookie(response, sessionCookie(token)) : response;
}

function sameOrigin(c: LedgerContext) {
	const expected = new URL(c.req.url).origin;
	const origin = c.req.header('Origin');
	if (origin) return origin === expected;
	const referer = c.req.header('Referer');
	if (!referer) return false;
	try {
		return new URL(referer).origin === expected;
	} catch {
		return false;
	}
}

function clientKey(c: LedgerContext) {
	return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

function isRateLimited(key: string) {
	const current = Date.now();
	const record = loginFailures.get(key);
	if (!record || record.resetAt <= current) {
		loginFailures.set(key, { count: 0, resetAt: current + LOGIN_WINDOW_MS });
		return false;
	}
	return record.count >= LOGIN_FAILURE_LIMIT;
}

function recordLoginFailure(key: string) {
	const current = Date.now();
	const record = loginFailures.get(key);
	if (!record || record.resetAt <= current) {
		loginFailures.set(key, { count: 1, resetAt: current + LOGIN_WINDOW_MS });
		return;
	}
	record.count += 1;
}

async function verifyTurnstile(c: LedgerContext, token: string) {
	const secret = c.env.TURNSTILE_SECRET_KEY || c.env.TURNSTILE_SECRET;
	if (!secret || !token) return false;
	try {
		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ secret, response: token, remoteip: clientKey(c) }).toString(),
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { success?: boolean };
		return body.success === true;
	} catch {
		return false;
	}
}

async function authenticate(c: LedgerContext): Promise<AuthState> {
	if (c.env.LEDGER_API_KEY && c.req.header('Authorization') === `Bearer ${c.env.LEDGER_API_KEY}`) {
		return { authenticated: true, source: 'bearer' };
	}
	const token = readCookie(c.req.raw, SESSION_COOKIE);
	if (!token) return { authenticated: false, source: 'none' };
	await ensureAuthTables(c.env.DB);
	const tokenHash = await hashToken(token);
	const row = await c.env.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first<SessionRow>();
	if (!row) return { authenticated: false, source: 'none' };
	const current = Date.now();
	if (Date.parse(row.expires_at) <= current) {
		await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
		return { authenticated: false, source: 'none' };
	}
	const expiresAt = new Date(current + SESSION_LIFETIME_MS).toISOString();
	await c.env.DB.prepare('UPDATE auth_sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?')
		.bind(expiresAt, new Date(current).toISOString(), tokenHash)
		.run();
	return { authenticated: true, source: 'session', expiresAt };
}

function jsonError(c: LedgerContext, status: ErrorStatus, message: string): Response {
	return c.json({ error: { message } }, status);
}

function registerOpenApi(route: unknown, handler: (c: LedgerContext) => unknown) {
	const openapi = (app as unknown as { openapi: (route: unknown, handler: unknown) => unknown }).openapi;
	return Reflect.apply(openapi, app, [route, handler]);
}

function validated<T>(c: LedgerContext, target: 'json' | 'query' | 'param'): T {
	const request = c.req as unknown as { valid: (name: string) => unknown };
	return request.valid(target) as T;
}

function toEntry(row: EntryRow) {
	return {
		id: row.id,
		type: row.type,
		amount: unitsToAmount(BigInt(row.amount_units)),
		displayAmount: displayAmount(unitsToAmount(BigInt(row.amount_units))),
		occurredAt: row.occurred_at,
		dueAt: row.due_at,
		dueStatus: row.due_status,
		category: row.category,
		note: row.note,
		isReversal: row.is_reversal === 1,
		reversalOf: row.reversal_of,
		reversedAt: row.reversed_at,
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function encodeCursor(value: CursorPayload) {
	return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(value: string): CursorPayload | null {
	try {
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
		const parsed: unknown = JSON.parse(atob(padded));
		if (!isCursorPayload(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function isCursorPayload(value: unknown): value is CursorPayload {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<CursorPayload>;
	return (
		typeof candidate.key === 'string' &&
		typeof candidate.id === 'string' &&
		Boolean(candidate.context) &&
		typeof candidate.context?.sort === 'string' &&
		(candidate.context.from === null || typeof candidate.context.from === 'string') &&
		(candidate.context.to === null || typeof candidate.context.to === 'string') &&
		(candidate.context.category === null || typeof candidate.context.category === 'string')
	);
}

function cursorContext(query: { sort: string; from?: string; to?: string; category?: string }): CursorContext {
	return {
		sort: query.sort,
		from: query.from ?? null,
		to: query.to ?? null,
		category: query.category ?? null,
	};
}

function cursorKey(row: EntryRow, sort: Sort) {
	if (sort.startsWith('occurredAt')) return row.occurred_at;
	if (sort.startsWith('createdAt')) return row.created_at;
	return row.amount_units;
}

function cursorColumn(sort: Sort) {
	if (sort.startsWith('occurredAt')) return 'occurred_at';
	if (sort.startsWith('createdAt')) return 'created_at';
	return 'CAST(amount_units AS INTEGER)';
}

const errorResponse = {
	description: 'Error',
	content: { 'application/json': { schema: errorSchema } },
} as const;

const healthRoute = createRoute({
	method: 'get',
	path: '/health',
	responses: {
		200: { description: 'Health status', content: { 'application/json': { schema: healthSchema } } },
	},
});

const healthDbRoute = createRoute({
	method: 'get',
	path: '/health/db',
	responses: {
		200: { description: 'Database health status', content: { 'application/json': { schema: healthSchema } } },
		503: errorResponse,
	},
});

const authLoginRoute = createRoute({
	method: 'post',
	path: '/auth/login',
	request: { body: { required: true, content: { 'application/json': { schema: authLoginSchema } } } },
	responses: {
		200: { description: 'Authenticated', content: { 'application/json': { schema: authSessionSchema } } },
		400: errorResponse,
		401: errorResponse,
		429: errorResponse,
	},
});

const authSessionRoute = createRoute({
	method: 'get',
	path: '/auth/session',
	responses: {
		200: { description: 'Session state', content: { 'application/json': { schema: authSessionSchema } } },
	},
});

const authLogoutRoute = createRoute({
	method: 'post',
	path: '/auth/logout',
	responses: {
		204: { description: 'Logged out' },
		403: errorResponse,
	},
});

const listEntriesRoute = createRoute({
	method: 'get',
	path: '/entries',
	security: [{ bearerAuth: [] }],
	request: { query: listQuerySchema },
	responses: {
		200: { description: 'A page of entries', content: { 'application/json': { schema: entryPageSchema } } },
		400: errorResponse,
		403: errorResponse,
	},
});

const createEntryRoute = createRoute({
	method: 'post',
	path: '/entries',
	security: [{ bearerAuth: [] }],
	parameters: [
		{
			name: 'Idempotency-Key',
			in: 'header',
			required: true,
			schema: { type: 'string', minLength: 1 },
		},
	],
	request: {
		body: { required: true, content: { 'application/json': { schema: createEntrySchema } } },
	},
	responses: {
		200: { description: 'Existing idempotent entry', content: { 'application/json': { schema: entryResponseSchema } } },
		201: { description: 'Created', content: { 'application/json': { schema: entryResponseSchema } } },
		400: errorResponse,
		403: errorResponse,
		409: errorResponse,
	},
});

const entryByIdRoute = createRoute({
	method: 'get',
	path: '/entries/{id}',
	security: [{ bearerAuth: [] }],
	request: { params: idParamSchema },
	responses: {
		200: { description: 'Entry', content: { 'application/json': { schema: entryResponseSchema } } },
		403: errorResponse,
		404: errorResponse,
	},
});

const reverseEntryRoute = createRoute({
	method: 'delete',
	path: '/entries/{id}',
	security: [{ bearerAuth: [] }],
	request: { params: idParamSchema },
	responses: {
		200: { description: 'Original and reversal entries', content: { 'application/json': { schema: reversalResponseSchema } } },
		403: errorResponse,
		404: errorResponse,
		409: errorResponse,
	},
});

const payEntryRoute = createRoute({
	method: 'post',
	path: '/entries/{id}/pay',
	security: [{ bearerAuth: [] }],
	request: { params: idParamSchema },
	responses: {
		200: { description: 'Updated entry', content: { 'application/json': { schema: entryResponseSchema } } },
		403: errorResponse,
		404: errorResponse,
		409: errorResponse,
	},
});

registerOpenApi(healthRoute, (c: LedgerContext) => c.json({ status: 'ok' }, 200));

registerOpenApi(healthDbRoute, async (c: LedgerContext) => {
	try {
		const result = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
		return c.json({ status: result?.ok === 1 ? 'ok' : 'degraded' }, 200);
	} catch (error) {
		console.error('D1 health check failed', error);
		return jsonError(c, 503, 'database health check failed');
	}
});

registerOpenApi(authLoginRoute, async (c: LedgerContext) => {
	if (c.req.header('Origin') || c.req.header('Referer')) {
		if (!sameOrigin(c)) return jsonError(c, 403, 'forbidden');
	}
	const key = clientKey(c);
	if (isRateLimited(key)) {
		const response = jsonError(c, 429, 'authentication failed');
		response.headers.set('Retry-After', '60');
		return response;
	}
	const input = validated<{ password: string; turnstileToken: string }>(c, 'json');
	const configuredPassword = c.env.LEDGER_PASSWORD;
	const turnstileValid = await verifyTurnstile(c, input.turnstileToken);
	if (!configuredPassword || input.password !== configuredPassword || !turnstileValid) {
		recordLoginFailure(key);
		return jsonError(c, 401, 'authentication failed');
	}
	await ensureAuthTables(c.env.DB);
	const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	const tokenHash = await hashToken(token);
	const createdAt = new Date();
	const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS).toISOString();
	await c.env.DB.prepare('INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)')
		.bind(tokenHash, createdAt.toISOString(), expiresAt, createdAt.toISOString())
		.run();
	loginFailures.delete(key);
	const response = c.json({ authenticated: true, expiresAt }, 200);
	return withCookie(response, sessionCookie(token));
});

registerOpenApi(authSessionRoute, async (c: LedgerContext) => {
	const auth = await authenticate(c);
	if (!auth.authenticated) return c.json({ authenticated: false }, 200);
	return renewSessionCookie(c, c.json({ authenticated: true, expiresAt: auth.expiresAt }, 200), auth);
});

registerOpenApi(authLogoutRoute, async (c: LedgerContext) => {
	if (c.req.header('Origin') || c.req.header('Referer')) {
		if (!sameOrigin(c)) return jsonError(c, 403, 'forbidden');
	}
	const token = readCookie(c.req.raw, SESSION_COOKIE);
	if (token) {
		await ensureAuthTables(c.env.DB);
		await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
	}
	return withCookie(new Response(null, { status: 204 }), sessionCookie('', 0));
});

app.get('/', async (c) => {
	if (c.env.ASSETS && c.req.header('Accept')?.includes('text/html')) {
		const asset = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw));
		if (asset.status !== 404 && (await asset.clone().text())) return asset;
	}
	return c.text('Hello World!');
});

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
	type: 'http',
	scheme: 'bearer',
	bearerFormat: 'API key',
});

app.doc('/openapi.json', {
	openapi: '3.0.3',
	info: {
		title: 'Ledger API',
		version: '1.0.0',
		description: 'Single-user RMB ledger with immutable entries and reversal-based correction.',
	},
	servers: [{ url: '/' }],
});

app.get('/docs', swaggerUI({ url: '/openapi.json', persistAuthorization: true }));

app.use('/entries', async (c, next) => {
	const auth = await authenticate(c);
	if (!auth.authenticated) return jsonError(c, 403, 'forbidden');
	const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
	const hasSourceHeader = Boolean(c.req.header('Origin') || c.req.header('Referer'));
	if (mutating && (auth.source === 'session' || hasSourceHeader) && !sameOrigin(c)) {
		return jsonError(c, 403, 'forbidden');
	}
	await next();
	c.res = renewSessionCookie(c, c.res, auth);
});

registerOpenApi(createEntryRoute, async (c: LedgerContext) => {
	const idempotencyKey = c.req.header('Idempotency-Key');
	if (!idempotencyKey) return jsonError(c, 400, 'Idempotency-Key is required');
	const input = validated<CreateEntryInput>(c, 'json');
	let amount: string;
	try {
		amount = normalizeAmount(input.amount);
	} catch {
		return jsonError(c, 400, 'invalid amount');
	}
	const occurredAt = new Date(input.occurredAt).toISOString();
	const dueAt = input.type === 'due_expense' ? new Date(input.dueAt!).toISOString() : null;
	const category = input.category ?? null;
	const note = input.note ?? null;
	const payload = JSON.stringify({ type: input.type, amount, occurredAt, dueAt, category, note });
	const existing = await c.env.DB.prepare('SELECT * FROM entries WHERE idempotency_key = ?').bind(idempotencyKey).first<StoredEntryRow>();
	if (existing) {
		if (existing.idempotency_payload !== payload) {
			return jsonError(c, 409, 'Idempotency-Key was already used with a different request');
		}
		return c.json({ entry: toEntry(existing) }, 200);
	}

	const id = crypto.randomUUID();
	const timestamp = now();
	try {
		await c.env.DB.prepare(
			`INSERT INTO entries (
				id, type, amount_units, occurred_at, due_at, due_status,
				category, note, idempotency_key, idempotency_payload, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				id,
				input.type,
				amountToUnits(amount).toString(),
				occurredAt,
				dueAt,
				input.type === 'due_expense' ? 'unpaid' : null,
				category,
				note,
				idempotencyKey,
				payload,
				timestamp,
				timestamp,
			)
			.run();
	} catch (error) {
		const concurrent = await c.env.DB.prepare('SELECT * FROM entries WHERE idempotency_key = ?')
			.bind(idempotencyKey)
			.first<StoredEntryRow>();
		if (concurrent?.idempotency_payload === payload) return c.json({ entry: toEntry(concurrent) }, 200);
		throw error;
	}
	const row = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	return c.json({ entry: toEntry(row as EntryRow) }, 201);
});

registerOpenApi(listEntriesRoute, async (c: LedgerContext) => {
	const query = validated<ListEntriesQuery>(c, 'query');
	const sort = query.sort as Sort;
	const where: string[] = [];
	const bindings: unknown[] = [];
	const timezone = c.env.LEDGER_TIMEZONE || 'Asia/Shanghai';
	if (query.from) {
		try {
			where.push('occurred_at >= ?');
			bindings.push(localDateToUtc(query.from, timezone));
		} catch {
			return jsonError(c, 400, 'invalid from date');
		}
	}
	if (query.to) {
		try {
			where.push('occurred_at < ?');
			bindings.push(localDateToUtc(query.to, timezone));
		} catch {
			return jsonError(c, 400, 'invalid to date');
		}
	}
	if (query.category) {
		where.push('category = ?');
		bindings.push(query.category);
	}

	const context = cursorContext(query);
	if (query.cursor) {
		const decoded = decodeCursor(query.cursor);
		if (!decoded || JSON.stringify(decoded.context) !== JSON.stringify(context)) {
			return jsonError(c, 400, 'invalid cursor');
		}
		const descending = sort.endsWith('.desc');
		const operator = descending ? '<' : '>';
		const keyColumn = cursorColumn(sort);
		where.push(`(${keyColumn} ${operator} ? OR (${keyColumn} = ? AND id ${operator} ?))`);
		bindings.push(decoded.key, decoded.key, decoded.id);
	}

	const result = await c.env.DB.prepare(
		`SELECT * FROM entries${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sortMap[sort]} LIMIT ?`,
	)
		.bind(...bindings, query.limit + 1)
		.all<EntryRow>();
	const rows = result.results;
	const page = rows.slice(0, query.limit);
	const nextCursor =
		rows.length > query.limit && page.length > 0
			? encodeCursor({ key: cursorKey(page[page.length - 1], sort), id: page[page.length - 1].id, context })
			: null;
	return c.json({ items: page.map(toEntry), nextCursor }, 200);
});

registerOpenApi(entryByIdRoute, async (c: LedgerContext) => {
	const { id } = validated<{ id: string }>(c, 'param');
	const row = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	if (!row) return jsonError(c, 404, 'entry not found');
	return c.json({ entry: toEntry(row) }, 200);
});

registerOpenApi(reverseEntryRoute, async (c: LedgerContext) => {
	const { id } = validated<{ id: string }>(c, 'param');
	const row = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	if (!row) return jsonError(c, 404, 'entry not found');
	if (row.is_reversal === 1 || row.reversal_of || row.reversed_at) {
		return jsonError(c, 409, 'reversal entries cannot be reversed');
	}
	if (await c.env.DB.prepare('SELECT id FROM entries WHERE reversal_of = ?').bind(id).first()) {
		return jsonError(c, 409, 'entry already reversed');
	}

	const reversalId = crypto.randomUUID();
	const timestamp = now();
	const reverseType: EntryType = row.type === 'income' ? 'expense' : 'income';
	try {
		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO entries (
					id, type, amount_units, occurred_at, category, note,
					is_reversal, reversal_of, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
			).bind(
				reversalId,
				reverseType,
				row.amount_units,
				row.occurred_at,
				row.category,
				`Reversal of ${row.id}${row.note ? `: ${row.note}` : ''}`,
				id,
				timestamp,
				timestamp,
			),
			c.env.DB.prepare(
				'UPDATE entries SET version = version + 1, reversed_at = ?, ' +
					"due_status = CASE WHEN type = 'due_expense' THEN 'cancelled' ELSE due_status END, " +
					'updated_at = ? WHERE id = ? AND reversal_of IS NULL AND is_reversal = 0 AND reversed_at IS NULL',
			).bind(timestamp, timestamp, id),
		]);
	} catch (error) {
		if (await c.env.DB.prepare('SELECT id FROM entries WHERE reversal_of = ?').bind(id).first()) {
			return jsonError(c, 409, 'entry already reversed');
		}
		throw error;
	}

	const updatedOriginal = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	const reversal = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(reversalId).first<EntryRow>();
	return c.json({ entry: toEntry(updatedOriginal as EntryRow), reversal: toEntry(reversal as EntryRow) }, 200);
});

registerOpenApi(payEntryRoute, async (c: LedgerContext) => {
	const { id } = validated<{ id: string }>(c, 'param');
	const row = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	if (!row) return jsonError(c, 404, 'entry not found');
	if (row.type !== 'due_expense') return jsonError(c, 409, 'only due expenses can be paid');
	if (row.reversed_at || row.due_status === 'cancelled') return jsonError(c, 409, 'reversed entries cannot be paid');
	if (row.due_status === 'paid') return c.json({ entry: toEntry(row) }, 200);

	const result = await c.env.DB.prepare(
		"UPDATE entries SET due_status = 'paid', version = version + 1, updated_at = ? " +
			"WHERE id = ? AND version = ? AND due_status = 'unpaid' AND reversed_at IS NULL",
	)
		.bind(now(), id, row.version)
		.run();
	if (!result.meta.changes) return jsonError(c, 409, 'entry was modified');
	const updated = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
	return c.json({ entry: toEntry(updated as EntryRow) }, 200);
});

app.notFound(async (c) => {
	if (c.env.ASSETS) {
		const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
		if (assetResponse.status !== 404) return assetResponse;
		const pathname = new URL(c.req.url).pathname;
		if (!pathname.includes('.')) {
			return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw));
		}
	}
	return c.text('Not Found', 404);
});

export default app satisfies ExportedHandler<Env>;
