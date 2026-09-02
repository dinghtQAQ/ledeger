import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Session = { authenticated: boolean; expiresAt?: string };
type CoarseCategory = { id: number; name: string };
type FineCategory = { id: number; name: string; coarseCategoryId: number; sortOrder: number; isActive: boolean };
type CategoriesResponse = { coarseCategories: CoarseCategory[]; fineCategories: FineCategory[] };
type LedgerSettings = { paydayDay: number; timezone: string };

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

function Turnstile({ onToken }: { onToken: (token: string) => void }) {
	const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
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
	const title = path === '/analytics' ? '分析' : path === '/entries' ? '账目' : path === '/settings' ? '设置' : '分析';
	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="brand" href="/analytics" onClick={(event) => { event.preventDefault(); navigate('/analytics'); }}>LeDeGer</a>
				<nav aria-label="主导航">
					<a className={path === '/analytics' ? 'active' : ''} href="/analytics" onClick={(event) => { event.preventDefault(); navigate('/analytics'); }}>分析</a>
					<a className={path === '/entries' ? 'active' : ''} href="/entries" onClick={(event) => { event.preventDefault(); navigate('/entries'); }}>账目</a>
					<a className={path === '/settings' ? 'active' : ''} href="/settings" onClick={(event) => { event.preventDefault(); navigate('/settings'); }}>设置</a>
				</nav>
				<button className="ghost-button" onClick={onLogout}>退出</button>
			</header>
			<main className="content">
				<div className="content-heading"><div><p className="eyebrow">CURRENT WORKSPACE</p><h1>{title}</h1></div><span className="session-dot" title={session.expiresAt ? `会话有效至 ${new Date(session.expiresAt).toLocaleString()}` : '会话有效'} /></div>
				{title === '分析' ? <AnalyticsPreview /> : path === '/settings' ? <SettingsPage /> : <section className="empty-state"><h2>{title}功能即将展开</h2><p>当前会话已建立，接口可以直接使用。</p></section>}
			</main>
		</div>
	);
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
	const [health, setHealth] = useState<'loading' | 'ready' | 'error'>('loading');
	useEffect(() => { api<{ status: string }>('/health').then(() => setHealth('ready')).catch(() => setHealth('error')); }, []);
	return <section className="overview"><div className="summary-grid"><article><span>周期收入</span><strong>—</strong></article><article><span>普通支出</span><strong>—</strong></article><article><span>周期净额</span><strong>—</strong></article><article><span>当前余额</span><strong>—</strong></article></div><div className="chart-placeholder"><div><p className="eyebrow">SPENDING MAP</p><h2>支出分类</h2><p className="muted">分析数据将在账目录入后显示。</p></div><span className={`status-chip ${health}`}>{health === 'ready' ? 'API 已连接' : health === 'error' ? 'API 未连接' : '连接中'}</span></div></section>;
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
	if (!session) return <div className="loading">正在检查会话…</div>;
	if (!session.authenticated) return <LoginPage onLogin={(next) => { setSession(next); navigate('/analytics'); }} />;
	if (path === '/login') navigate('/analytics');
	return <AppShell session={session} onLogout={async () => { await api('/auth/logout', { method: 'POST' }); setSession({ authenticated: false }); navigate('/login'); }} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
