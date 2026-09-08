import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Session = { authenticated: boolean; expiresAt?: string };
type CoarseCategory = { id: number; name: string };
type FineCategory = { id: number; name: string; coarseCategoryId: number; sortOrder: number; isActive: boolean };
type CategoriesResponse = { coarseCategories: CoarseCategory[]; fineCategories: FineCategory[] };
type LedgerSettings = { paydayDay: number; timezone: string };
type AnalyticsItem = { id: number | null; name: string; parentId?: number; parentName?: string; amount: string; displayAmount: string; count: number };
type AnalyticsSummary = { from: string; to: string; periodIncome: string; periodExpense: string; periodNet: string; currentBalance: string; items: AnalyticsItem[] };
type EntryType = 'income' | 'expense' | 'due_expense';
type Entry = {
	id: string;
	type: EntryType;
	amount: string;
	displayAmount: string;
	occurredAt: string;
	category: string | null;
	categoryId?: number | null;
	subcategoryId?: number | null;
	note: string | null;
	isReversal: boolean;
	reversalOf: string | null;
	reversedAt?: string | null;
	dueAt?: string | null;
	dueStatus?: 'unpaid' | 'paid' | 'cancelled' | null;
	version?: number;
	createdAt?: string;
	updatedAt?: string;
};
type EntryPage = { items: Entry[]; nextCursor: string | null };
type EntryDetailResponse = { entry: Entry; relatedEntry: Entry | null };

declare global {
	interface Window {
		turnstile?: {
			render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }) => void;
		};
		__TURNSTILE_TOKEN__?: string;
	}
}

async function api<T>(path: string, init: RequestInit = {}) {
	const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { Accept: 'application/json', ...init.headers } });
	if (response.status === 401 || response.status === 403) {
		window.dispatchEvent(new Event('session-expired'));
		throw new Error('session expired');
	}
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
		throw new Error(body?.error?.message || '请求失败');
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

function navigate(path: string) {
	if (window.location.pathname === path) return;
	window.history.pushState({}, '', path);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

function currentDateTimeLocal() {
	const date = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToIso(value: string) {
	return new Date(value).toISOString();
}

function nextCalendarDate(value: string) {
	if (!value) return '';
	const date = new Date(`${value}T00:00:00`);
	date.setDate(date.getDate() + 1);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateInTimezone(timezone: string, date = new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
	const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

function shiftCalendarDate(value: string, days: number) {
	const date = new Date(`${value}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function shiftCalendarMonth(value: string, months: number) {
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1 + months, 1));
	const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, lastDay));
	return date.toISOString().slice(0, 10);
}

function shiftWageCycle(range: { start: string; end: string }, months: number) {
	return { start: shiftCalendarMonth(range.start, months), end: shiftCalendarMonth(range.end, months) };
}

function currentWageCycle(paydayDay: number, timezone: string) {
	const today = localDateInTimezone(timezone);
	const [year, month, day] = today.split('-').map(Number);
	let startYear = year;
	let startMonth = month;
	if (day < paydayDay) {
		startMonth -= 1;
		if (startMonth === 0) { startMonth = 12; startYear -= 1; }
	}
	const start = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(paydayDay).padStart(2, '0')}`;
	let endYear = startYear;
	let endMonth = startMonth + 1;
	if (endMonth === 13) { endMonth = 1; endYear += 1; }
	const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(paydayDay).padStart(2, '0')}`;
	return { start, end };
}

function entryTypeLabel(type: EntryType) {
	return type === 'income' ? '收入' : type === 'expense' ? '支出' : '到期支出';
}

function isReversibleEntry(entry: Entry) {
	return (entry.type === 'income' || entry.type === 'expense') && !entry.isReversal && !entry.reversedAt;
}

function reversalErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : '';
	if (message.includes('already reversed') || message.includes('cannot be reversed')) return '这笔账目已完成冲正，不能重复操作';
	return message ? `冲正失败：${message}` : '冲正失败，请稍后重试';
}

function createIdempotencyKey() {
	return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPositiveAccountingAmount(value: string) {
	if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
	const [integer, fraction = ''] = value.split('.');
	if (BigInt(integer) > 0n) return true;
	const kept = fraction.padEnd(4, '0').slice(0, 4);
	let units = BigInt(kept || '0');
	if (fraction[4] && fraction[4] >= '5') units += 1n;
	return units > 0n;
}

function displayEntryCategory(entry: Entry, categories: CategoriesResponse | null) {
	const coarse = categories?.coarseCategories.find((item) => item.id === entry.categoryId);
	const fine = categories?.fineCategories.find((item) => item.id === entry.subcategoryId);
	if (fine && coarse) return `${coarse.name} / ${fine.name}`;
	if (entry.category) return entry.category;
	return coarse?.name || (entry.type === 'income' ? '未分类收入' : '未分类');
}

const pieChartColors = ['#1f5c49', '#4c9a6d', '#b7793e', '#a33c35', '#55738a', '#8064a2', '#9b8a3d'];

function pieChartGradient(items: AnalyticsItem[]) {
	const positiveItems = items.filter((item) => Number(item.amount) > 0);
	const total = positiveItems.reduce((sum, item) => sum + Number(item.amount), 0);
	if (!total) return '#dfe5df 0 100%';
	let cursor = 0;
	return positiveItems.map((item, index) => {
		const start = cursor;
		cursor += Number(item.amount) / total * 100;
		return `${pieChartColors[index % pieChartColors.length]} ${start}% ${cursor}%`;
	}).join(', ');
}

function Turnstile({ onToken }: { onToken: (token: string) => void }) {
	const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
	const [ready, setReady] = useState(Boolean(window.turnstile));
	useEffect(() => {
		if (window.turnstile) {
			setReady(true);
			return;
		}
		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		script.async = true;
		script.onload = () => setReady(Boolean(window.turnstile));
		document.head.appendChild(script);
		return () => script.remove();
	}, []);
	useEffect(() => {
		const target = document.querySelector<HTMLElement>('[data-turnstile]');
		if (ready && target && window.turnstile && !target.dataset.rendered) {
			target.dataset.rendered = 'true';
			window.turnstile.render(target, {
				sitekey: siteKey,
				callback: onToken,
				'expired-callback': () => onToken(''),
			});
		}
	}, [onToken, ready, siteKey]);
	return <div className="turnstile" data-turnstile aria-label="Turnstile 人机验证">{!ready && '正在加载验证…'}</div>;
}

function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
	const [password, setPassword] = useState('');
	const [turnstileToken, setTurnstileToken] = useState(window.__TURNSTILE_TOKEN__ || '');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const tokenHandler = useMemo(() => (token: string) => setTurnstileToken(token), []);
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError('');
		if (!turnstileToken) {
			setError('请完成验证');
			return;
		}
		setBusy(true);
		try {
			const session = await api<Session>('/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password, turnstileToken }),
			});
			onLogin(session);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : '登录失败');
		} finally {
			setBusy(false);
		}
	}
	return (
		<main className="auth-layout">
			<section className="auth-panel" aria-labelledby="login-title">
				<p className="eyebrow">LEDEGER / PRIVATE LEDGER</p>
				<h1 id="login-title">欢迎回来</h1>
				<p className="muted">登录后查看你的工资周期与账目分析。</p>
				<form onSubmit={submit}>
					<label htmlFor="password">密码</label>
					<input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
					<Turnstile onToken={tokenHandler} />
					{error && <p className="error" role="alert">{error}</p>}
					<button type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
				</form>
			</section>
		</main>
	);
}

function AppShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
	const path = window.location.pathname;
	const isEntryDetail = /^\/entries\/[^/]+$/.test(path);
	const title = path === '/analytics' ? '分析' : path === '/entries' ? '账目' : path === '/entries/new' ? '新增记账' : isEntryDetail ? '账目详情' : path === '/settings' ? '设置' : '分析';
	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="brand" href="/analytics" onClick={(event) => { event.preventDefault(); navigate('/analytics'); }}>LeDeGer</a>
				<nav aria-label="主导航">
					<a className={path === '/analytics' ? 'active' : ''} href="/analytics" onClick={(event) => { event.preventDefault(); navigate('/analytics'); }}>分析</a>
					<a className={path.startsWith('/entries') ? 'active' : ''} href="/entries" onClick={(event) => { event.preventDefault(); navigate('/entries'); }}>账目</a>
					<a className={path === '/settings' ? 'active' : ''} href="/settings" onClick={(event) => { event.preventDefault(); navigate('/settings'); }}>设置</a>
				</nav>
				<button className="ghost-button" onClick={onLogout}>退出</button>
			</header>
			<main className="content">
				<div className="content-heading"><div><p className="eyebrow">CURRENT WORKSPACE</p><h1>{title}</h1></div><span className="session-dot" title={session.expiresAt ? `会话有效至 ${new Date(session.expiresAt).toLocaleString()}` : '会话有效'} /></div>
				{title === '分析' ? <AnalyticsPreview /> : path === '/settings' ? <SettingsPage /> : path === '/entries/new' ? <NewEntryPage /> : path === '/entries' ? <EntriesPage /> : isEntryDetail ? <EntryDetailsPage id={path.split('/')[2]} /> : <section className="empty-state"><h2>{title}功能即将展开</h2><p>当前会话已建立，接口可以直接使用。</p></section>}
			</main>
		</div>
	);
}

function EntriesPage() {
	const [items, setItems] = useState<Entry[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [categories, setCategories] = useState<CategoriesResponse | null>(null);
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const [type, setType] = useState('');
	const [categoryId, setCategoryId] = useState('');
	const [subcategoryId, setSubcategoryId] = useState('');
	const [sort, setSort] = useState('occurredAt.desc');
	const [error, setError] = useState('');
	const [loadMoreError, setLoadMoreError] = useState('');
	const [reversalError, setReversalError] = useState('');
	const [reversingId, setReversingId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);

	function queryString(cursor?: string) {
		const params = new URLSearchParams({ limit: '50', sort });
		if (from) params.set('from', from);
		if (to) params.set('to', nextCalendarDate(to));
		if (type) params.set('type', type);
		if (categoryId) params.set('categoryId', categoryId);
		if (subcategoryId) params.set('subcategoryId', subcategoryId);
		if (cursor) params.set('cursor', cursor);
		return `/entries?${params.toString()}`;
	}

	async function loadEntries() {
		setLoading(true);
		setError('');
		setLoadMoreError('');
		try {
			const [nextPage, nextCategories] = await Promise.all([
				api<EntryPage>(queryString()),
				api<CategoriesResponse>('/categories'),
			]);
			setItems(nextPage.items);
			setNextCursor(nextPage.nextCursor);
			setCategories(nextCategories);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : '账目加载失败');
		} finally {
			setLoading(false);
		}
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		setLoadMoreError('');
		try {
			const nextPage = await api<EntryPage>(queryString(nextCursor));
			setItems((current) => [...current, ...nextPage.items]);
			setNextCursor(nextPage.nextCursor);
		} catch (caught) {
			setLoadMoreError(caught instanceof Error ? caught.message : '加载更多失败');
		} finally {
			setLoadingMore(false);
		}
	}

	async function reverse(entry: Entry) {
		if (!isReversibleEntry(entry) || reversingId) return;
		if (!window.confirm('确认冲正这笔账目？系统会保留原记录，并新增一笔相反类型的冲正记录。')) return;
		setReversingId(entry.id);
		setReversalError('');
		try {
			await api(`/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
			await loadEntries();
		} catch (caught) {
			setReversalError(reversalErrorMessage(caught));
		} finally {
			setReversingId(null);
		}
	}

	function resetAndLoad() {
		void loadEntries();
	}

	useEffect(() => { void loadEntries(); }, []);

	if (loading) return <section className="empty-state"><p>正在加载账目…</p></section>;
	if (error) return <section className="empty-state"><p className="error" role="alert">{error}</p><button type="button" onClick={() => void loadEntries()}>重试</button></section>;
	return <section className="entries-layout">
		<div className="entries-toolbar"><div><p className="eyebrow">LEDGER ENTRIES</p><p className="muted">当前显示 {items.length} 笔记录</p></div><button type="button" className="primary-button" onClick={() => navigate('/entries/new')}>新增账目</button></div>
		{reversalError && <p className="error" role="alert">{reversalError}</p>}
		<form className="entries-filters" onSubmit={(event) => { event.preventDefault(); resetAndLoad(); }}>
			<div><label htmlFor="entries-from">开始日期</label><input id="entries-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
			<div><label htmlFor="entries-to">结束日期</label><input id="entries-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
			<div><label htmlFor="entries-type">类型</label><select id="entries-type" value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option><option value="income">收入</option><option value="expense">支出</option><option value="due_expense">到期支出</option></select></div>
			<div><label htmlFor="entries-category">粗分类</label><select id="entries-category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">全部粗分类</option>{categories?.coarseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
			<div><label htmlFor="entries-subcategory">细分类</label><select id="entries-subcategory" value={subcategoryId} disabled={!categoryId} onChange={(event) => setSubcategoryId(event.target.value)}><option value="">全部细分类</option>{categories?.fineCategories.filter((fine) => !categoryId || String(fine.coarseCategoryId) === categoryId).map((fine) => <option key={fine.id} value={fine.id}>{fine.name}{!fine.isActive ? '（已停用）' : ''}</option>)}</select></div>
			<div><label htmlFor="entries-sort">排序</label><select id="entries-sort" value={sort} onChange={(event) => setSort(event.target.value)}><option value="occurredAt.desc">发生时间：新到旧</option><option value="occurredAt.asc">发生时间：旧到新</option><option value="createdAt.desc">创建时间：新到旧</option><option value="amount.desc">金额：高到低</option><option value="amount.asc">金额：低到高</option></select></div>
			<div className="filter-actions"><button type="submit" className="primary-button">应用筛选</button><button type="button" className="secondary-button" onClick={() => { setFrom(''); setTo(''); setType(''); setCategoryId(''); setSubcategoryId(''); setSort('occurredAt.desc'); window.setTimeout(() => void loadEntries(), 0); }}>重置</button></div>
		</form>
		{items.length ? <div className="entry-list">{items.map((entry) => <article className={`entry-row ${entry.isReversal ? 'reversal' : ''}`} key={entry.id}>
			<a className="entry-main entry-link" href={`/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); navigate(`/entries/${entry.id}`); }}><strong>{entryTypeLabel(entry.type)}{entry.isReversal && ' · 冲正'}</strong>{entry.type !== 'income' && <span className="muted">{displayEntryCategory(entry, categories)}</span>}<span className="muted">{new Date(entry.occurredAt).toLocaleString('zh-CN')}</span>{entry.isReversal && <span className="reversal-label">冲正记录</span>}</a>
			<div className="entry-side"><strong className={entry.type === 'income' ? 'amount-income' : 'amount-expense'}>{entry.type === 'income' ? '+' : '-'}{entry.displayAmount}</strong>{entry.note && <span className="muted">{entry.note}</span>}{entry.reversedAt && <span className="reversal-label">已冲正</span>}{isReversibleEntry(entry) && <button type="button" className="danger-button" onClick={() => void reverse(entry)} disabled={reversingId !== null}>{reversingId === entry.id ? '处理中…' : '冲正这笔账目'}</button>}</div>
		</article>)}</div> : <div className="empty-state"><h2>没有匹配的账目</h2><p className="muted">尝试调整筛选条件，或记录第一笔账目。</p><button type="button" className="primary-button" onClick={() => navigate('/entries/new')}>新增账目</button></div>}
		{loadMoreError && <div className="pagination-feedback"><p className="error" role="alert">{loadMoreError}</p><button type="button" className="secondary-button" onClick={() => void loadMore()}>重试加载</button></div>}
		{nextCursor && !loadMoreError && <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? '加载中…' : '加载更多'}</button>}
	</section>;
}

function EntryDetailsPage({ id }: { id: string }) {
	const [entry, setEntry] = useState<Entry | null>(null);
	const [relatedEntry, setRelatedEntry] = useState<Entry | null>(null);
	const [categories, setCategories] = useState<CategoriesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');

	async function load() {
		setLoading(true); setError(''); setRelatedEntry(null);
		try {
			const [detail, categoryData] = await Promise.all([
				api<EntryDetailResponse>(`/entries/${encodeURIComponent(id)}`),
				api<CategoriesResponse>('/categories'),
			]);
			setEntry(detail.entry);
			setRelatedEntry(detail.relatedEntry);
			setCategories(categoryData);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : '详情加载失败');
		} finally { setLoading(false); }
	}

	useEffect(() => { void load(); }, [id]);

	async function reverse() {
		if (!entry || !isReversibleEntry(entry)) return;
		if (!window.confirm('确认冲正这笔账目？系统会保留原记录，并新增一笔相反类型的冲正记录。')) return;
		setBusy(true); setError(''); setMessage('');
		try { await api(`/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }); setMessage('已完成冲正'); await load(); }
		catch (caught) { setError(reversalErrorMessage(caught)); }
		finally { setBusy(false); }
	}

	if (loading) return <section className="empty-state"><p>正在加载账目详情…</p></section>;
	if (error && !entry) return <section className="empty-state"><p className="error" role="alert">{error}</p><button type="button" onClick={() => void load()}>重试</button></section>;
	if (!entry) return <section className="empty-state"><h2>找不到这笔账目</h2><button type="button" onClick={() => navigate('/entries')}>返回账目</button></section>;
	const positive = entry.type === 'income';
	return <section className="entry-detail-layout">
		<div className="detail-toolbar"><button type="button" className="secondary-button" onClick={() => navigate('/entries')}>返回账目</button><span className={`detail-badge ${entry.isReversal ? 'reversal' : ''}`}>{entry.isReversal ? '冲正记录' : entry.reversedAt ? '已冲正原账目' : '原账目'}</span></div>
		{(error || message) && <p className={error ? 'error' : 'success'} role="status">{error || message}</p>}
		<div className="detail-panel"><div className="detail-amount"><span className="muted">{entryTypeLabel(entry.type)}</span><strong className={positive ? 'amount-income' : 'amount-expense'}>{positive ? '+' : '-'}{entry.displayAmount}</strong></div>
			<dl className="detail-grid"><div><dt>发生时间</dt><dd>{new Date(entry.occurredAt).toLocaleString('zh-CN')}</dd></div>{entry.type !== 'income' && <><div><dt>粗分类</dt><dd>{displayEntryCategory(entry, categories)}</dd></div><div><dt>细分类</dt><dd>{entry.subcategoryId ? categories?.fineCategories.find((fine) => fine.id === entry.subcategoryId)?.name || `ID ${entry.subcategoryId}` : '未选择'}</dd></div></>}<div><dt>备注</dt><dd>{entry.note || '无'}</dd></div><div><dt>记录 ID</dt><dd className="detail-id">{entry.id}</dd></div><div><dt>状态</dt><dd>{entry.isReversal ? '冲正记录' : entry.reversedAt ? '已冲正' : '有效'}</dd></div></dl>
			{relatedEntry && <div className="relation-panel"><span className="muted">关联账目</span><a href={`/entries/${relatedEntry.id}`} onClick={(event) => { event.preventDefault(); navigate(`/entries/${relatedEntry.id}`); }}>{relatedEntry.isReversal ? '查看冲正记录' : '查看原账目'} · {relatedEntry.displayAmount}</a></div>}
			{isReversibleEntry(entry) && <button type="button" className="danger-button" onClick={() => void reverse()} disabled={busy}>{busy ? '处理中…' : '冲正这笔账目'}</button>}
		</div>
	</section>;
}

function NewEntryPage() {
	const [type, setType] = useState<'income' | 'expense'>('expense');
	const [categories, setCategories] = useState<CategoriesResponse | null>(null);
	const [categoryId, setCategoryId] = useState('');
	const [subcategoryId, setSubcategoryId] = useState('');
	const [amount, setAmount] = useState('');
	const [occurredAt, setOccurredAt] = useState(currentDateTimeLocal);
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const idempotencyRef = useRef<{ payload: string; key: string } | null>(null);

	useEffect(() => {
		api<CategoriesResponse>('/categories').then(setCategories).catch((caught) => setError(caught instanceof Error ? caught.message : '分类加载失败')).finally(() => setLoading(false));
	}, []);

	const availableFineCategories = categories?.fineCategories.filter((fine) => fine.isActive && String(fine.coarseCategoryId) === categoryId) ?? [];

	function changeType(nextType: 'income' | 'expense') {
		setType(nextType);
		if (nextType === 'income') {
			setCategoryId('');
			setSubcategoryId('');
		}
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError('');
		if (type === 'expense' && !categoryId) {
			setError('普通支出必须选择粗分类');
			return;
		}
		if (!isPositiveAccountingAmount(amount.trim())) {
			setError('请输入大于 0 的金额');
			return;
		}
		if (!occurredAt) {
			setError('请选择发生时间');
			return;
		}
		setBusy(true);
		try {
			const payload = {
				type,
				amount: amount.trim(),
				occurredAt: dateTimeLocalToIso(occurredAt),
				categoryId: type === 'expense' && categoryId ? Number(categoryId) : null,
				subcategoryId: type === 'expense' && subcategoryId ? Number(subcategoryId) : null,
				note: note.trim() || null,
			};
			const payloadKey = JSON.stringify(payload);
			if (!idempotencyRef.current || idempotencyRef.current.payload !== payloadKey) {
				idempotencyRef.current = { payload: payloadKey, key: createIdempotencyKey() };
			}
			await api<{ entry: Entry }>('/entries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyRef.current.key },
				body: payloadKey,
			});
			idempotencyRef.current = null;
			navigate('/entries');
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : '账目创建失败');
		} finally {
			setBusy(false);
		}
	}

	if (loading) return <section className="empty-state"><p>正在加载分类…</p></section>;
	if (!categories) return <section className="empty-state"><p className="error" role="alert">{error || '分类加载失败'}</p></section>;
	return <section className="new-entry-layout">
		<div className="form-intro"><p className="eyebrow">NEW LEDGER ENTRY</p><h2>记下一笔新账</h2><p className="muted">收入可以不选分类；普通支出需要选择粗分类，细分类可留空。</p></div>
		<form className="entry-form" onSubmit={submit}>
			<fieldset className="entry-type-field"><legend>类型</legend><div className="type-toggle" role="group" aria-label="账目类型"><button type="button" className={type === 'expense' ? 'selected' : ''} onClick={() => changeType('expense')}>普通支出</button><button type="button" className={type === 'income' ? 'selected' : ''} onClick={() => changeType('income')}>收入</button></div></fieldset>
			{type === 'expense' && <div className="field-grid"><div><label htmlFor="entry-category">粗分类<span aria-hidden="true"> *</span></label><select id="entry-category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">请选择粗分类</option>{categories.coarseCategories.map((coarse) => <option key={coarse.id} value={coarse.id}>{coarse.name}</option>)}</select></div><div><label htmlFor="entry-subcategory">细分类（可选）</label><select id="entry-subcategory" value={subcategoryId} disabled={!categoryId || availableFineCategories.length === 0} onChange={(event) => setSubcategoryId(event.target.value)}><option value="">不选择细分类</option>{availableFineCategories.map((fine) => <option key={fine.id} value={fine.id}>{fine.name}</option>)}</select></div></div>}
			<div className="field-grid"><div><label htmlFor="entry-amount">金额</label><input id="entry-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></div><div><label htmlFor="entry-occurred-at">发生时间</label><input id="entry-occurred-at" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></div></div>
			<div><label htmlFor="entry-note">备注（可选）</label><textarea id="entry-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="写点容易回想的说明" /></div>
			{error && <p className="error" role="alert">{error}</p>}
			<div className="form-actions"><button type="button" className="secondary-button" onClick={() => navigate('/entries')}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '保存中…' : '保存账目'}</button></div>
		</form>
	</section>;
}

function SettingsPage() {
	const [categories, setCategories] = useState<CategoriesResponse | null>(null);
	const [settings, setSettings] = useState<LedgerSettings | null>(null);
	const [paydayDay, setPaydayDay] = useState('20');
	const [newName, setNewName] = useState('');
	const [newParent, setNewParent] = useState('1');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');

	async function reload() {
		const [nextCategories, nextSettings] = await Promise.all([
			api<CategoriesResponse>('/categories'),
			api<LedgerSettings>('/settings/ledger'),
		]);
		setCategories(nextCategories);
		setSettings(nextSettings);
		setPaydayDay(String(nextSettings.paydayDay));
		if (!newParent && nextCategories.coarseCategories[0]) setNewParent(String(nextCategories.coarseCategories[0].id));
	}

	useEffect(() => {
		reload().catch((caught) => setError(caught instanceof Error ? caught.message : '设置加载失败'));
	}, []);

	async function savePayday(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true); setError(''); setMessage('');
		try {
			const next = await api<LedgerSettings>('/settings/ledger', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paydayDay: Number(paydayDay) }) });
			setSettings(next); setPaydayDay(String(next.paydayDay)); setMessage('发薪日已保存');
		} catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败'); }
		finally { setBusy(false); }
	}

	async function createFine(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!newName.trim()) return;
		setBusy(true); setError(''); setMessage('');
		try {
			await api<FineCategory>('/categories/fine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, coarseCategoryId: Number(newParent) }) });
			setNewName(''); setMessage('细类已新增'); await reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : '新增失败'); }
		finally { setBusy(false); }
	}

	async function updateFine(fine: FineCategory, patch: { name?: string; sortOrder?: number }) {
		setBusy(true); setError(''); setMessage('');
		try { await api<FineCategory>(`/categories/fine/${fine.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); await reload(); setMessage('细类已更新'); }
		catch (caught) { setError(caught instanceof Error ? caught.message : '更新失败'); }
		finally { setBusy(false); }
	}

	async function disableFine(fine: FineCategory) {
		if (!window.confirm(`停用“${fine.name}”？历史账目仍会保留。`)) return;
		setBusy(true); setError(''); setMessage('');
		try { await api<FineCategory>(`/categories/fine/${fine.id}/disable`, { method: 'POST' }); await reload(); setMessage('细类已停用'); }
		catch (caught) { setError(caught instanceof Error ? caught.message : '停用失败'); }
		finally { setBusy(false); }
	}

	if (!categories || !settings) return <section className="empty-state"><p>正在加载设置…</p></section>;
	return <section className="settings-layout">
		{(error || message) && <p className={error ? 'error' : 'success'} role="status">{error || message}</p>}
		<div className="settings-grid">
			<section className="settings-section">
				<div className="section-heading"><div><p className="eyebrow">PAYDAY ANCHOR</p><h2>工资周期</h2></div><span className="muted">时区：{settings.timezone}</span></div>
				<form className="inline-form" onSubmit={savePayday}>
					<label htmlFor="payday-day">每月发薪日</label>
					<input id="payday-day" type="number" min="1" max="28" value={paydayDay} onChange={(event) => setPaydayDay(event.target.value)} required />
					<button type="submit" disabled={busy}>保存</button>
				</form>
				<p className="muted">可设置每月 1 至 28 日，默认值为 20 日。</p>
			</section>
			<section className="settings-section">
				<div className="section-heading"><div><p className="eyebrow">COARSE CATEGORIES</p><h2>固定粗类</h2></div><span className="muted">只读</span></div>
				<div className="coarse-list">{categories.coarseCategories.map((coarse) => <div className="category-row" key={coarse.id}><span className="category-id">{coarse.id}</span><strong>{coarse.name}</strong></div>)}</div>
			</section>
		</div>
		<section className="settings-section fine-section">
			<div className="section-heading"><div><p className="eyebrow">FINE CATEGORIES</p><h2>细类管理</h2></div><span className="muted">停用后不可用于新账目</span></div>
			<form className="fine-create" onSubmit={createFine}>
				<label htmlFor="fine-name">名称</label><input id="fine-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：房租" required />
				<label htmlFor="fine-parent">所属粗类</label><select id="fine-parent" value={newParent} onChange={(event) => setNewParent(event.target.value)}>{categories.coarseCategories.map((coarse) => <option key={coarse.id} value={coarse.id}>{coarse.name}</option>)}</select>
				<button type="submit" disabled={busy}>新增细类</button>
			</form>
			<div className="fine-list">{categories.coarseCategories.map((coarse) => <div className="fine-group" key={coarse.id}><h3>{coarse.name}</h3>{categories.fineCategories.filter((fine) => fine.coarseCategoryId === coarse.id).map((fine, index, siblings) => <div className={`fine-row ${fine.isActive ? '' : 'inactive'}`} key={fine.id}><span className="fine-name">{fine.name}{!fine.isActive && <em>已停用</em>}</span><span className="fine-actions"><button type="button" title="上移" aria-label={`${fine.name} 上移`} disabled={busy || index === 0} onClick={() => updateFine(fine, { sortOrder: siblings[index - 1].sortOrder - 1 })}>↑</button><button type="button" title="下移" aria-label={`${fine.name} 下移`} disabled={busy || index === siblings.length - 1} onClick={() => updateFine(fine, { sortOrder: siblings[index + 1].sortOrder + 1 })}>↓</button><button type="button" onClick={() => { const name = window.prompt('新的细类名称', fine.name); if (name?.trim()) void updateFine(fine, { name: name.trim() }); }}>改名</button>{fine.isActive && <button type="button" onClick={() => void disableFine(fine)}>停用</button>}</span></div>)}</div>)}</div>
		</section>
	</section>;
}

function AnalyticsPreview() {
	const [settings, setSettings] = useState<LedgerSettings | null>(null);
	const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
	const [range, setRange] = useState<{ start: string; end: string } | null>(null);
	const [level, setLevel] = useState<'coarse' | 'fine'>('coarse');
	const [cycleOffset, setCycleOffset] = useState(0);
	const [rangeMode, setRangeMode] = useState<'cycle' | 'custom'>('cycle');
	const [customStart, setCustomStart] = useState('');
	const [customEnd, setCustomEnd] = useState('');
	const [rangeError, setRangeError] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		api<LedgerSettings>('/settings/ledger').then((nextSettings) => {
			setSettings(nextSettings);
			setRange(currentWageCycle(nextSettings.paydayDay, nextSettings.timezone));
		}).catch((caught) => setError(caught instanceof Error ? caught.message : '分析加载失败'));
	}, []);
	useEffect(() => {
		if (!range) return;
		setSummary(null);
		setError('');
		api<AnalyticsSummary>(`/analytics/summary?from=${range.start}&to=${range.end}&level=${level}`)
			.then(setSummary)
			.catch((caught) => setError(caught instanceof Error ? caught.message : '分析加载失败'));
	}, [range, level]);

	function selectCycle(offset: number) {
		if (!settings) return;
		const current = currentWageCycle(settings.paydayDay, settings.timezone);
		setCycleOffset(offset);
		setRangeMode('cycle');
		setRange(shiftWageCycle(current, offset));
		setRangeError('');
	}

	function applyCustomRange(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!customStart || !customEnd) {
			setRangeError('请选择开始和结束日期');
			return;
		}
		if (customStart > customEnd) {
			setRangeError('开始日期不能晚于结束日期');
			return;
		}
		setRangeError('');
		setCycleOffset(0);
		setRangeMode('custom');
		setRange({ start: customStart, end: nextCalendarDate(customEnd) });
	}

	if (error) return <section className="empty-state"><p className="error" role="alert">{error}</p><button type="button" onClick={() => window.location.reload()}>重试</button></section>;
	if (!settings || !range || !summary) return <section className="empty-state"><p>正在加载分析…</p></section>;
	const maxAmount = Math.max(...summary.items.map((item) => Number(item.amount)), 1);
	const displayedEnd = shiftCalendarDate(range.end, -1);
	const chartName = level === 'coarse' ? '粗分类支出' : '细分类支出';
	const pieItems = summary.items.filter((item) => Number(item.amount) > 0);
	const pieTotal = pieItems.reduce((sum, item) => sum + Number(item.amount), 0);
	return <section className="overview">
		<div className="analysis-range"><div><p className="eyebrow">{rangeMode === 'custom' ? 'CUSTOM DATE RANGE' : cycleOffset === 0 ? 'CURRENT WAGE CYCLE' : cycleOffset < 0 ? 'PREVIOUS WAGE CYCLE' : 'NEXT WAGE CYCLE'}</p><h2>{range.start} 至 {displayedEnd}</h2></div><span className="muted">时区：{settings.timezone}</span></div>
		<div className="analysis-controls">
			<div className="cycle-controls" aria-label="工资周期导航"><button type="button" className="secondary-button" onClick={() => selectCycle(cycleOffset - 1)}>上一周期</button><button type="button" className="secondary-button" onClick={() => selectCycle(0)}>当前周期</button><button type="button" className="secondary-button" onClick={() => selectCycle(cycleOffset + 1)}>下一周期</button></div>
			<div className="level-toggle" role="group" aria-label="图表层级"><button type="button" className={level === 'coarse' ? 'selected' : ''} aria-pressed={level === 'coarse'} onClick={() => setLevel('coarse')}>粗类</button><button type="button" className={level === 'fine' ? 'selected' : ''} aria-pressed={level === 'fine'} onClick={() => setLevel('fine')}>细类</button></div>
		</div>
		<form className="analysis-custom-range" onSubmit={applyCustomRange}><div><label htmlFor="analytics-from">开始日期</label><input id="analytics-from" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></div><div><label htmlFor="analytics-to">结束日期</label><input id="analytics-to" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div><button type="submit" className="secondary-button">应用范围</button></form>
		{rangeError && <p className="error" role="alert">{rangeError}</p>}
		<div className="summary-grid"><article><span>周期收入</span><strong className="amount-income">+{summary.periodIncome}</strong></article><article><span>普通支出</span><strong className="amount-expense">-{summary.periodExpense}</strong></article><article><span>周期净额</span><strong className={summary.periodNet.startsWith('-') ? 'amount-expense' : 'amount-income'}>{summary.periodNet}</strong></article><article><span>当前余额</span><strong>{summary.currentBalance}</strong></article></div>
		<div className="chart-panel"><div className="section-heading"><div><p className="eyebrow">SPENDING MAP</p><h2>{chartName}</h2></div><span className="muted">金额 / 笔数</span></div><div className="chart-visuals"><div className="bar-chart-wrap"><div className={`bar-chart ${level === 'fine' ? 'fine-chart' : ''}`} role="img" aria-label={`${chartName}柱状图`}>{summary.items.map((item) => <div className="bar-item" key={item.id ?? 'uncategorized'}><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(0, Number(item.amount) / maxAmount * 100)}%` }} title={`${item.name}：${item.displayAmount}，${item.count} 笔`} /></div><strong>{item.name}</strong>{level === 'fine' && item.parentName && <span className="muted">{item.parentName}</span>}<span className="muted">{item.displayAmount} · {item.count} 笔</span></div>)}</div></div><div className="pie-chart-wrap"><div className="pie-chart" role="img" aria-label={`${chartName}饼图`} style={{ background: `conic-gradient(${pieChartGradient(summary.items)})` }} />{pieItems.length ? <div className="pie-legend">{pieItems.map((item, index) => <div className="pie-legend-item" key={item.id ?? 'uncategorized'}><span className="pie-legend-swatch" style={{ background: pieChartColors[index % pieChartColors.length] }} /><span>{item.name}</span><span className="muted">{item.displayAmount} · {pieTotal ? `${(Number(item.amount) / pieTotal * 100).toFixed(1)}%` : '0%'}</span></div>)}</div> : <p className="muted pie-empty">当前周期暂无支出</p>}</div></div></div>
	</section>;
}

function Root() {
	const [session, setSession] = useState<Session | null>(null);
	const [path, setPath] = useState(window.location.pathname);
	useEffect(() => {
		const onPop = () => setPath(window.location.pathname);
		const onExpired = () => { setSession({ authenticated: false }); navigate('/login'); };
		window.addEventListener('popstate', onPop);
		window.addEventListener('session-expired', onExpired);
		api<Session>('/auth/session').then(setSession).catch(() => setSession({ authenticated: false }));
		return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('session-expired', onExpired); };
	}, []);
	useEffect(() => {
		if (session && !session.authenticated && path !== '/login') navigate('/login');
	}, [session, path]);
	if (!session) return <div className="loading">正在检查会话…</div>;
	if (!session.authenticated) return <LoginPage onLogin={(next) => { setSession(next); navigate('/analytics'); }} />;
	if (path === '/login') navigate('/analytics');
	return <AppShell session={session} onLogout={async () => { await api('/auth/logout', { method: 'POST' }); setSession({ authenticated: false }); navigate('/login'); }} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
