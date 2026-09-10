import { test, expect } from '@playwright/test';

test('잠긴 공간은 메모와 비밀번호 입력 없이 공개됨', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null } }));
  await page.goto('/private');
  await expect(page.getByRole('heading', { name: '나만의 공간', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '패스키로 들어가기' })).toBeVisible();
  await expect(page.locator('.vault-note')).toHaveCount(0);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/private-locked-mobile.png', fullPage: true });
});

test('등록 취소는 안내하고 비공개 자료를 내려받지 않음', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/register/options', route => route.fulfill({ json: { challengeId: 'cancel-test', options: {
    challenge: 'dGVzdC1jaGFsbGVuZ2UtMzItYnl0ZXMtbG9uZy0xMjM0NTY', rp: { name: 'Test', id: 'localhost' },
    user: { id: 'dXNlcg', name: 'Test', displayName: 'Test' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  } } }));
  let cancelled = false;
  await page.route('**/api/auth/cancel', route => { cancelled = true; return route.fulfill({ status: 204 }); });
  await page.addInitScript(() => { Object.defineProperty(navigator.credentials, 'create', { value: async () => { throw new DOMException('Cancelled', 'NotAllowedError'); } }); });
  await page.goto('/private#enroll=example-test-invite');
  expect(page.url()).not.toContain('enroll=');
  await page.getByLabel('패스키 이름').fill('취소할 키');
  await page.getByRole('button', { name: '패스키 등록', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('취소했거나');
  expect(cancelled).toBe(true);
  await expect(page.locator('.vault-note')).toHaveCount(0);
});
