import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const origin = 'https://portfolio-passkey.duckdns.org';
const accounts = readFileSync('.deploy-runtime/live-accounts.jsonl', 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const browser = await chromium.launch({ executablePath: process.env.ONE_LINK_BROWSER_PATH, headless: true });
const transcript = [];
const pending = [];
const errors = [];
const contexts = [];
async function screenshot(page, path) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path, fullPage: true });
}
const redact = value => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    ['invitation','privateKey'].includes(k) ? '[REDACTED]' : k === 'notes' ? v.map(n => ({ id: n.id, title: '[PRIVATE]', body: '[PRIVATE]' })) : redact(v)]));
  return value;
};
async function api(page, path, body, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, body, method });
}
async function createClient(account) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, locale: 'ko-KR' }); contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (!response.url().startsWith(`${origin}/api/`)) return;
    const task = (async () => {
      const request = response.request();
      let requestBody; try { requestBody = request.postDataJSON(); } catch { requestBody = null; }
      let body; try { body = await response.json(); } catch { body = null; }
      transcript.push({ method: request.method(), path: new URL(response.url()).pathname, request: redact(requestBody), status: response.status(), response: redact(body), cookie: '[REDACTED]' });
    })(); pending.push(task);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const addAuthenticator = async () => (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })).authenticatorId;
  const authenticatorId = await addAuthenticator();
  await page.goto(account.url);
  await page.getByLabel('패스키 이름').fill(`${account.name} 첫 키`);
  await page.getByRole('button', { name: '패스키 등록', exact: true }).click();
  await page.getByRole('heading', { name: '내 패스키', exact: true }).waitFor();
  assert.equal(await page.locator('.vault-note').count(), 3);
  return { context, page, cdp, authenticatorId, addAuthenticator };
}
try {
  const anonymous = await browser.newContext(); contexts.push(anonymous);
  const publicPage = await anonymous.newPage();
  const root = await publicPage.goto(origin);
  assert.equal(root.status(), 200);
  assert.equal((await api(publicPage, '/api/private')).status, 401);
  const a = await createClient(accounts[0]);
  const firstCredentials = (await a.cdp.send('WebAuthn.getCredentials', { authenticatorId: a.authenticatorId })).credentials;
  // Chromium software private keys stay in this process only; never write or publish them.
  const firstId = (await api(a.page, '/api/passkeys')).body.keys[0].id;
  await a.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a.authenticatorId });
  const secondAuthenticator = await a.addAuthenticator();
  await a.page.getByLabel('패스키 이름').fill('검증 A 예비 키');
  await a.page.getByRole('button', { name: '패스키 등록', exact: true }).click();
  await a.page.getByText('2개 등록됨', { exact: true }).waitFor();
  mkdirSync('public/evidence', { recursive: true });
  await screenshot(a.page, 'public/evidence/live-two-passkeys.png');
  const b = await createClient(accounts[1]);
  assert.equal((await api(a.page, `/api/users/${accounts[1].id}/private`)).status, 403);
  assert.equal((await api(b.page, `/api/users/${accounts[0].id}/private`)).status, 403);
  assert.equal((await api(a.page, '/api/private', { userId: accounts[1].id })).body.ownerId, accounts[0].id);
  assert.equal((await api(a.page, '/api/private')).body.notes.length, 3);
  assert.equal((await api(b.page, '/api/private')).body.notes.length, 3);
  assert.equal((await api(a.page, `/api/passkeys/${encodeURIComponent(firstId)}`, undefined, 'DELETE')).status, 204);
  const staleCookies = await a.context.cookies(origin);
  await a.page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await a.page.getByRole('button', { name: '패스키로 들어가기', exact: true }).waitFor();
  const replayContext = await browser.newContext(); contexts.push(replayContext);
  await replayContext.addCookies(staleCookies);
  const stalePage = await replayContext.newPage(); await stalePage.goto(origin);
  assert.equal((await api(stalePage, '/api/private')).status, 401);
  await a.page.getByRole('button', { name: '패스키로 들어가기', exact: true }).click();
  await a.page.getByRole('heading', { name: '내 패스키', exact: true }).waitFor();
  assert.equal(await a.page.locator('.vault-note').count(), 3);
  const login = [...transcript].reverse().find(item => item.path === '/api/auth/login/verify' && item.status === 200);
  assert.ok(login);
  assert.equal((await api(a.page, '/api/auth/login/verify', login.request)).status, 400);
  await screenshot(a.page, 'public/evidence/live-after-deletion.png');
  await a.page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await a.page.getByRole('button', { name: '패스키로 들어가기', exact: true }).waitFor();
  await a.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: secondAuthenticator });
  const restored = await a.addAuthenticator();
  for (const credential of firstCredentials) await a.cdp.send('WebAuthn.addCredential', { authenticatorId: restored, credential });
  await a.page.getByRole('button', { name: '패스키로 들어가기', exact: true }).click();
  await a.page.getByRole('status').filter({ hasText: '삭제된 패스키' }).waitFor();
  await screenshot(a.page, 'public/evidence/live-deleted-key-rejected.png');
  assert.deepEqual(errors, []);
  await Promise.all(pending);
  const report = { executedAt: new Date().toISOString(), origin, environment: 'Production HTTPS with Chromium virtual CTAP2 authenticators. Not a physical passkey or Google Password Manager.', result: 'passed',
    checks: ['public page 200', 'anonymous private 401', 'actual browser registration for two accounts', 'two keys in account A', 'A→B and B→A 403', 'body owner spoof ignored', '3 notes unchanged per account', 'logout token replay 401', 'remaining key login 200', 'challenge replay 400', 'deleted key login 403', 'no browser runtime errors'], requests: transcript };
  writeFileSync('records/live-passkey-evidence.json', JSON.stringify(report, null, 2));
  writeFileSync('public/evidence/live-passkey-evidence.json', JSON.stringify(report, null, 2));
  console.log(`Live HTTPS verification passed: ${report.checks.length} checks.`);
} finally { for (const context of contexts) await context.close(); await browser.close(); }
