import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		(globalThis as typeof globalThis & { __TURNSTILE_TOKEN__?: string }).__TURNSTILE_TOKEN__ = 'browser-test-token';
	});
	await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
	await page.goto('/login');
	await page.getByLabel('密码').fill('test-password');
	await page.getByRole('button', { name: '登录' }).click();
	await expect(page).toHaveURL(/\/analytics$/);
}

async function openNewEntry(page: import('@playwright/test').Page) {
	await page.getByRole('link', { name: '账目' }).click();
	await expect(page).toHaveURL(/\/entries$/);
	await page.getByRole('button', { name: '新增账目' }).first().click();
	await expect(page).toHaveURL(/\/entries\/new$/);
}

test.describe('新增收入与普通支出', () => {
	test('登录后默认进入分析并显示周期摘要与粗类图表', async ({ page }) => {
		await page.clock.install({ time: new Date('2026-09-02T00:00:00Z') });
		await login(page);
		await expect(page.getByRole('heading', { name: '分析' })).toBeVisible();
		await expect(page.getByRole('heading', { name: '2026-08-20 至 2026-09-19' })).toBeVisible();
		await expect(page.getByText('周期收入')).toBeVisible();
		await expect(page.getByText('普通支出')).toBeVisible();
		await expect(page.getByRole('img', { name: '粗分类支出柱状图' })).toBeVisible();
		await expect(page.getByText('住房')).toBeVisible();
		await expect(page.getByText('餐饮')).toBeVisible();
	});

	test('创建普通支出后在账目列表可见', async ({ page }) => {
		await login(page);
		await openNewEntry(page);
		await expect(page.getByRole('heading', { name: '新增记账' })).toBeVisible();
		await page.getByLabel('粗分类').selectOption('2');
		await page.getByLabel('金额').fill('12.3456');
		await page.getByLabel('备注（可选）').fill('browser expense');
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page).toHaveURL(/\/entries$/);
		await expect(page.getByText('browser expense')).toBeVisible();
		await expect(page.getByText('-12.346')).toBeVisible();
	});

	test('收入可以不选择分类并成功创建', async ({ page }) => {
		await login(page);
		await openNewEntry(page);
		await page.getByRole('button', { name: '收入' }).click();
		await page.getByLabel('金额').fill('100.0016');
		await page.getByLabel('备注（可选）').fill('browser income');
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page).toHaveURL(/\/entries$/);
		await expect(page.getByText('browser income')).toBeVisible();
		await expect(page.getByText('+100.002')).toBeVisible();
	});

	test('支出缺少粗分类时显示校验错误', async ({ page }) => {
		await login(page);
		await openNewEntry(page);
		await page.getByLabel('金额').fill('1');
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page.getByRole('alert')).toHaveText('普通支出必须选择粗分类');
		await expect(page).toHaveURL(/\/entries\/new$/);
	});

	test('重复提交使用同一幂等键且只保留一笔账目', async ({ page }) => {
		let postCount = 0;
		await page.route('**/entries', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			postCount += 1;
			const response = await route.fetch();
			if (postCount === 1) {
				await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'temporary failure' } }) });
				return;
			}
			await route.fulfill({ response });
		});
		await login(page);
		await openNewEntry(page);
		await page.getByLabel('粗分类').selectOption('2');
		await page.getByLabel('金额').fill('8');
		await page.getByLabel('备注（可选）').fill('browser retry');
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page.getByRole('alert')).toHaveText('temporary failure');
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page).toHaveURL(/\/entries$/);
		await expect(page.getByText('browser retry')).toHaveCount(1);
		await expect(page.getByText('-8.000')).toHaveCount(1);
		expect(postCount).toBe(2);
	});
});

test.describe('分析层级与范围导航', () => {
	test('支持粗细类切换、工资周期导航和包含结束日的自定义范围', async ({ page }) => {
		await page.clock.install({ time: new Date('2026-09-02T00:00:00Z') });
		let settingsWrites = 0;
		page.on('request', (request) => {
			if (request.url().includes('/settings/ledger') && request.method() === 'PUT') settingsWrites += 1;
		});
		await login(page);
		await expect(page.getByRole('heading', { name: '2026-08-20 至 2026-09-19' })).toBeVisible();

		const nextCycleRequest = page.waitForRequest((request) => request.url().includes('/analytics/summary') && new URL(request.url()).searchParams.get('from') === '2026-09-20');
		await page.getByRole('button', { name: '下一周期' }).click();
		expect(new URL((await nextCycleRequest).url()).searchParams.get('to')).toBe('2026-10-20');
		await expect(page.getByRole('heading', { name: '2026-09-20 至 2026-10-19' })).toBeVisible();
		await page.getByRole('button', { name: '上一周期' }).click();
		await expect(page.getByRole('heading', { name: '2026-08-20 至 2026-09-19' })).toBeVisible();

		await page.getByLabel('开始日期').fill('2026-09-01');
		await page.getByLabel('结束日期').fill('2026-09-02');
		const customRangeRequest = page.waitForRequest((request) => request.url().includes('/analytics/summary') && new URL(request.url()).searchParams.get('from') === '2026-09-01');
		await page.getByRole('button', { name: '应用范围' }).click();
		expect(new URL((await customRangeRequest).url()).searchParams.get('to')).toBe('2026-09-03');
		await expect(page.getByRole('heading', { name: '2026-09-01 至 2026-09-02' })).toBeVisible();

		const fineRangeRequest = page.waitForRequest((request) => request.url().includes('/analytics/summary') && new URL(request.url()).searchParams.get('level') === 'fine');
		await page.getByRole('button', { name: '细类' }).click();
		expect(new URL((await fineRangeRequest).url()).searchParams.get('from')).toBe('2026-09-01');
		await expect(page.getByRole('heading', { name: '细分类支出' })).toBeVisible();
		await expect(page.getByRole('img', { name: '细分类支出柱状图' })).toBeVisible();
		await expect(page.getByRole('button', { name: '细类' })).toHaveAttribute('aria-pressed', 'true');
		expect(settingsWrites).toBe(0);
	});
});

test.describe('账目列表与详情', () => {
	test('支持游标加载更多并跳转到账目详情', async ({ page }) => {
		const first = {
			id: 'browser-entry-1', type: 'expense', amount: '12.0000', displayAmount: '12.000', occurredAt: '2026-09-02T10:00:00.000Z',
			category: '餐饮', categoryId: 2, subcategoryId: null, note: '第一页', isReversal: false, reversalOf: null, reversedAt: null,
		};
		const second = { ...first, id: 'browser-entry-2', occurredAt: '2026-09-01T10:00:00.000Z', note: '第二页' };
		let listCalls = 0;
		await page.route('**/entries?*', async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			const url = new URL(route.request().url());
			if (url.searchParams.get('limit') === '100') {
				return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [first, second], nextCursor: null }) });
			}
			listCalls += 1;
			if (listCalls === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [first], nextCursor: 'cursor-1' }) });
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [second], nextCursor: null }) });
		});
		await page.route('**/entries/browser-entry-1', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: first }) }));
		await login(page);
		await page.getByRole('link', { name: '账目' }).click();
		await expect(page.getByText('第一页')).toBeVisible();
		await page.getByRole('button', { name: '加载更多' }).click();
		await expect(page.getByText('第二页')).toBeVisible();
		await page.getByRole('link', { name: /支出/ }).first().click();
		await expect(page).toHaveURL(/\/entries\/browser-entry-1$/);
		await expect(page.getByRole('heading', { name: '账目详情' })).toBeVisible();
		await expect(page.getByText('第一页')).toBeVisible();
	});

	test('从列表确认冲正后保留原账目并显示冲正记录', async ({ page }) => {
		const note = `browser reversal ${Date.now()}`;
		await page.on('dialog', async (dialog) => {
			expect(dialog.type()).toBe('confirm');
			expect(dialog.message()).toContain('确认冲正');
			await dialog.accept();
		});
		await login(page);
		await openNewEntry(page);
		await page.getByLabel('粗分类').selectOption('2');
		await page.getByLabel('金额').fill('7.25');
		await page.getByLabel('备注（可选）').fill(note);
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page).toHaveURL(/\/entries$/);
		const originalRow = page.locator('.entry-row').filter({ has: page.getByText(note, { exact: true }) });
		await expect(originalRow).toContainText('支出');
		await originalRow.getByRole('button', { name: '冲正这笔账目' }).click();
		await expect(originalRow).toContainText('已冲正');
		await expect(originalRow.getByRole('button', { name: '冲正这笔账目' })).toHaveCount(0);
		await expect(page.locator('.entry-row.reversal').filter({ hasText: '冲正记录' }).filter({ hasText: note })).toBeVisible();
	});

	test('冲正确认取消时不发起请求，旧版和冲正记录不显示操作', async ({ page }) => {
		const ordinary = {
			id: 'browser-ordinary-entry', type: 'expense', amount: '6.0000', displayAmount: '6.000', occurredAt: '2026-09-02T10:00:00.000Z',
			category: '餐饮', categoryId: 2, subcategoryId: null, note: 'ordinary cancel', isReversal: false, reversalOf: null, reversedAt: null,
		};
		const dueExpense = {
			id: 'browser-due-expense', type: 'due_expense', amount: '5.0000', displayAmount: '5.000', occurredAt: '2026-09-02T10:00:00.000Z',
			category: 'legacy', categoryId: null, subcategoryId: null, note: 'legacy due', isReversal: false, reversalOf: null, reversedAt: null,
		};
		const reversal = {
			...dueExpense, id: 'browser-reversal', type: 'income', note: 'Reversal of browser-due-expense', isReversal: true, reversalOf: dueExpense.id,
		};
		let deleteCalls = 0;
		await page.route('**/entries?*', async (route) => {
			if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [ordinary, dueExpense, reversal], nextCursor: null }) });
			return route.continue();
		});
		await page.route('**/entries/*', async (route) => {
			if (route.request().method() === 'DELETE') deleteCalls += 1;
			return route.continue();
		});
		await page.on('dialog', async (dialog) => dialog.dismiss());
		await login(page);
		await page.getByRole('link', { name: '账目' }).click();
		await expect(page.getByText('ordinary cancel')).toBeVisible();
		await expect(page.getByText('legacy due')).toBeVisible();
		await expect(page.getByRole('button', { name: '冲正这笔账目' })).toHaveCount(1);
		await page.getByText('ordinary cancel').locator('..').locator('..').getByRole('button', { name: '冲正这笔账目' }).click();
		await expect(page.getByText('ordinary cancel').locator('..').locator('..').getByRole('button', { name: '冲正这笔账目' })).toBeVisible();
		expect(deleteCalls).toBe(0);
	});

	test('从详情页确认冲正后显示完成状态和关联记录', async ({ page }) => {
		const note = `browser detail reversal ${Date.now()}`;
		await page.on('dialog', async (dialog) => dialog.accept());
		await login(page);
		await openNewEntry(page);
		await page.getByLabel('粗分类').selectOption('2');
		await page.getByLabel('金额').fill('9');
		await page.getByLabel('备注（可选）').fill(note);
		await page.getByRole('button', { name: '保存账目' }).click();
		await expect(page).toHaveURL(/\/entries$/);
		await page.locator('.entry-row').filter({ has: page.getByText(note, { exact: true }) }).getByRole('link').click();
		await expect(page.getByRole('button', { name: '冲正这笔账目' })).toBeVisible();
		await page.getByRole('button', { name: '冲正这笔账目' }).click();
		await expect(page.getByText('已冲正', { exact: true })).toBeVisible();
		await expect(page.getByText('查看冲正记录')).toBeVisible();
		await expect(page.getByRole('button', { name: '冲正这笔账目' })).toHaveCount(0);
	});

	test('冲正发生并发冲突时显示明确反馈', async ({ page }) => {
		const entry = {
			id: 'browser-conflict-entry', type: 'expense', amount: '5.0000', displayAmount: '5.000', occurredAt: '2026-09-02T10:00:00.000Z',
			category: '餐饮', categoryId: 2, subcategoryId: null, note: 'conflict entry', isReversal: false, reversalOf: null, reversedAt: null,
		};
		await page.route('**/entries/browser-conflict-entry', async (route) => {
			if (route.request().method() === 'DELETE') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'entry already reversed' } }) });
			return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry }) });
		});
		await page.route('**/entries?*', async (route) => {
			if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [entry], nextCursor: null }) });
			return route.continue();
		});
		await page.on('dialog', async (dialog) => dialog.accept());
		await login(page);
		await page.getByRole('link', { name: '账目' }).click();
		await expect(page.getByText('conflict entry')).toBeVisible();
		await page.getByRole('link', { name: /支出/ }).click();
		await expect(page.getByRole('button', { name: '冲正这笔账目' })).toBeVisible();
		await page.getByRole('button', { name: '冲正这笔账目' }).click();
		await expect(page.getByRole('status')).toHaveText('这笔账目已完成冲正，不能重复操作');
	});
});

test.describe('发布边界与设置', () => {
	test('未认证访问受保护路由时回到登录页', async ({ page }) => {
		await page.goto('/settings');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
	});

	test('会话失效后回到登录页', async ({ page }) => {
		await login(page);
		await page.route('**/analytics/summary*', async (route) => {
			await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'forbidden' } }) });
		});
		await page.reload();
		await expect(page).toHaveURL(/\/login$/);
	});

	test('账目详情直达仍由 SPA 接管，API 请求保持 JSON', async ({ page }) => {
		await login(page);
		const api404 = await page.request.get('/entries/unknown-api/path');
		expect(api404.status()).toBe(404);
		expect(api404.headers()['content-type']).toContain('application/json');
		await page.goto('/entries/direct-detail-route');
		await expect(page).toHaveURL(/\/entries\/direct-detail-route$/);
		await expect(page.getByRole('heading', { name: '账目详情' })).toBeVisible();
		await expect(page.getByRole('alert')).toHaveText('entry not found');
	});

	test('设置页覆盖细类新增、改名、排序、停用和发薪日', async ({ page }) => {
		await page.clock.install({ time: new Date('2026-09-02T00:00:00Z') });
		await login(page);
		await page.getByRole('link', { name: '设置' }).click();
		await expect(page).toHaveURL(/\/settings$/);

		const suffix = Date.now();
		const firstName = `浏览器细类一-${suffix}`;
		const secondName = `浏览器细类二-${suffix}`;
		const renamedName = `浏览器细类改名-${suffix}`;
		const create = async (name: string) => {
			await page.getByLabel('名称').fill(name);
			await page.getByLabel('所属粗类').selectOption('2');
			await page.getByRole('button', { name: '新增细类' }).click();
			await expect(page.getByText(name, { exact: true })).toBeVisible();
		};
		await create(firstName);
		await create(secondName);

		const secondRow = page.locator('.fine-row').filter({ hasText: secondName });
		await secondRow.getByRole('button', { name: `${secondName} 上移` }).click();
		await expect(page.locator('.fine-group').filter({ has: page.getByRole('heading', { name: '餐饮' }) }).locator('.fine-name').first()).toContainText(secondName);

		page.once('dialog', (dialog) => dialog.accept(renamedName));
		await secondRow.getByRole('button', { name: '改名' }).click();
		await expect(page.getByText(renamedName, { exact: true })).toBeVisible();

		const renamedRow = page.locator('.fine-row').filter({ hasText: renamedName });
		page.once('dialog', (dialog) => dialog.accept());
		await renamedRow.getByRole('button', { name: '停用' }).click();
		await expect(renamedRow).toContainText('已停用');

		await page.getByLabel('每月发薪日').fill('1');
		await page.getByRole('button', { name: '保存' }).click();
		await expect(page.getByText('发薪日已保存')).toBeVisible();
		await page.getByRole('link', { name: '分析' }).click();
		await expect(page.getByRole('heading', { name: '2026-09-01 至 2026-09-30' })).toBeVisible();
	});
});
