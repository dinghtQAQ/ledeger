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
