import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createApp } from '../server/app.mjs';
import { openStore, provision, hash } from '../server/store.mjs';

const b64 = value => Buffer.from(value).toString('base64url');
const sha = value => createHash('sha256').update(value).digest();
// Small CBOR encoder for a software authenticator's COSE key and "none" attestation.
function cbor(value) {
  const head = (major, length) => length < 24 ? Buffer.from([(major << 5) | length])
    : length < 256 ? Buffer.from([(major << 5) | 24, length]) : Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('Unsupported CBOR value');
}
function authenticator(userId) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const id = randomBytes(32);
  let counter = 0;
  const publicKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const clientData = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return { id: b64(id), publicKey,
    register(options, origin) {
      const client = clientData('webauthn.create', options.challenge, origin);
      const authData = Buffer.concat([sha(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, id.length]), id, publicKey]);
      return { id: b64(id), rawId: b64(id), type: 'public-key', response: { clientDataJSON: b64(client), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] }, clientExtensionResults: {} };
    },
    login(options, origin, invalid = false) {
      const client = clientData('webauthn.get', options.challenge, origin);
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const auth = Buffer.concat([sha(options.rpId), Buffer.from([0x05]), count]);
      const signature = sign('sha256', Buffer.concat([auth, sha(client)]), pair.privateKey);
      if (invalid) signature[signature.length - 1] ^= 1;
      return { id: b64(id), rawId: b64(id), type: 'public-key', response: { clientDataJSON: b64(client), authenticatorData: b64(auth), signature: b64(signature), userHandle: userId }, clientExtensionResults: {} };
    },
  };
}

test('real WebAuthn signatures, single-use challenges, owner isolation and revocation', async () => {
  const db = openStore(':memory:');
  const origin = 'http://localhost:3187';
  const server = createApp({ db, origin, limiting: false }).listen(3187, '127.0.0.1');
  const evidence = [];
  const redact = obj => {
    if (Array.isArray(obj)) return obj.map(redact);
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k,
      ['invitation', 'cookie', 'token'].includes(k.toLowerCase()) ? '[REDACTED]' : k === 'notes' ? v.map(n => ({ id: n.id, title: '[PRIVATE]', body: '[PRIVATE]' })) : redact(v)]));
    return obj;
  };
  function client() {
    let cookies = {};
    return {
      snapshot: () => ({ ...cookies }),
      async request(label, method, path, body, customCookies, requestOrigin = origin) {
        const headers = { origin: requestOrigin, cookie: Object.entries(customCookies || cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        for (const setCookie of response.headers.getSetCookie()) { const [k, ...v] = setCookie.split(';')[0].split('='); cookies[k] = v.join('='); }
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        evidence.push({ label, request: { method, path, headers: { Origin: requestOrigin, Cookie: headers.cookie ? '[REDACTED]' : '(none)' }, body: redact(body) }, response: { status: response.status, body: redact(data), setCookie: response.headers.has('set-cookie') ? '[REDACTED]' : undefined } });
        return { status: response.status, data };
      },
    };
  }
  const a = provision(db, '검증 A', origin);
  const b = provision(db, '검증 B', origin, 'test');
  const ca = client(), cb = client(), anonymous = client();
  const a1 = authenticator(a.id), a2 = authenticator(a.id), b1 = authenticator(b.id);
  const invitation = user => new URLSearchParams(user.url.split('#')[1]).get('enroll');
  async function enroll(c, user, key, name, useInvite) {
    const options = await c.request(`등록 질문 ${name}`, 'POST', '/api/auth/register/options', { name, ...(useInvite ? { invitation: invitation(user) } : {}) });
    assert.equal(options.status, 200);
    const result = await c.request(`등록 성공 ${name}`, 'POST', '/api/auth/register/verify', { challengeId: options.data.challengeId, credential: key.register(options.data.options, origin) });
    assert.equal(result.status, 201);
    return options.data;
  }
  async function login(c, key, label, invalid = false) {
    const challenge = await c.request(`${label} 질문`, 'POST', '/api/auth/login/options', {});
    const body = { challengeId: challenge.data.challengeId, credential: key.login(challenge.data.options, origin, invalid) };
    const result = await c.request(label, 'POST', '/api/auth/login/verify', body);
    return { result, body, challenge: challenge.data.options.challenge };
  }
  try {
    assert.equal((await anonymous.request('미인증 자료 거절', 'GET', '/api/private')).status, 401);
    assert.equal((await anonymous.request('초대 없는 등록 거절', 'POST', '/api/auth/register/options', { name: '침입자' })).status, 401);
    assert.equal((await anonymous.request('다른 Origin 거절', 'POST', '/api/auth/login/options', {}, undefined, 'https://foreign.example')).status, 403);
    const pending1 = await ca.request('취소용 첫 등록 질문', 'POST', '/api/auth/register/options', { name: '취소 키', invitation: invitation(a) });
    const pending2 = await ca.request('다른 등록 질문', 'POST', '/api/auth/register/options', { name: '취소 키', invitation: invitation(a) });
    assert.notEqual(pending1.data.options.challenge, pending2.data.options.challenge);
    await ca.request('등록 취소', 'POST', '/api/auth/cancel', { challengeId: pending1.data.challengeId });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 0);
    assert.equal((await ca.request('취소된 질문 거절', 'POST', '/api/auth/register/verify', { challengeId: pending1.data.challengeId, credential: a1.register(pending1.data.options, origin) })).status, 400);
    await enroll(ca, a, a1, 'A 노트북', true);
    assert.equal((await anonymous.request('사용한 초대 거절', 'POST', '/api/auth/register/options', { name: '재사용', invitation: invitation(a) })).status, 403);
    await enroll(ca, a, a2, 'A 예비 보안 키', false);
    await enroll(cb, b, b1, 'B 노트북', true);
    const keys = await ca.request('A 패스키 두 개', 'GET', '/api/passkeys');
    assert.equal(keys.data.keys.length, 2);
    assert.equal(keys.data.keys[0].publicKey, b64(a1.publicKey));
    const aBefore = await ca.request('A 자신의 자료 성공', 'GET', '/api/private');
    const bBefore = await cb.request('B 자신의 자료 성공', 'GET', '/api/private');
    assert.equal(aBefore.data.notes.length, 3); assert.equal(bBefore.data.notes.length, 3);
    assert.notDeepEqual(aBefore.data.notes, bBefore.data.notes);
    assert.equal((await ca.request('A가 B 자료 요청 거절', 'GET', `/api/users/${b.id}/private`)).status, 403);
    assert.equal((await cb.request('B가 A 자료 요청 거절', 'GET', `/api/users/${a.id}/private`)).status, 403);
    assert.equal((await ca.request('A가 B 패스키 삭제 거절', 'DELETE', `/api/passkeys/${b1.id}`)).status, 403);
    const aAfter = await ca.request('거절 뒤 A 자료 건수', 'GET', '/api/private');
    const bAfter = await cb.request('거절 뒤 B 자료 건수', 'GET', '/api/private');
    assert.equal(aAfter.data.notes.length, aBefore.data.notes.length); assert.equal(bAfter.data.notes.length, bBefore.data.notes.length);
    assert.equal((await ca.request('주소 계정 위조에도 A 자료만 반환', 'GET', `/api/private?userId=${b.id}`)).data.ownerId, a.id);
    assert.equal((await ca.request('본문 계정 위조에도 A 자료만 반환', 'POST', '/api/private', { userId: b.id })).data.ownerId, a.id);
    const oldCookies = ca.snapshot();
    await ca.request('로그아웃', 'POST', '/api/auth/logout', {});
    assert.equal((await ca.request('로그아웃 뒤 같은 세션 재사용 거절', 'GET', '/api/private', undefined, oldCookies)).status, 401);
    const success = await login(ca, a1, '올바른 서명 로그인 성공'); assert.equal(success.result.status, 200);
    assert.equal((await ca.request('사용한 로그인 질문 재사용 거절', 'POST', '/api/auth/login/verify', success.body)).status, 400);
    const bad = await login(ca, a1, '틀린 서명 로그인 거절', true); assert.equal(bad.result.status, 403);
    assert.notEqual(success.challenge, bad.challenge);
    const expires = await ca.request('만료용 질문', 'POST', '/api/auth/login/options', {});
    db.prepare('UPDATE challenges SET expires_at=0 WHERE id=?').run(expires.data.challengeId);
    assert.equal((await ca.request('만료된 질문 거절', 'POST', '/api/auth/login/verify', { challengeId: expires.data.challengeId, credential: a1.login(expires.data.options, origin) })).status, 400);
    const foreign = await ca.request('Origin 검증용 질문', 'POST', '/api/auth/login/options', {});
    assert.equal((await ca.request('서명된 다른 Origin 거절', 'POST', '/api/auth/login/verify', { challengeId: foreign.data.challengeId, credential: a1.login(foreign.data.options, 'https://foreign.example') })).status, 403);
    const concurrency = await ca.request('동시 재사용용 질문', 'POST', '/api/auth/login/options', {});
    const sameBody = { challengeId: concurrency.data.challengeId, credential: a1.login(concurrency.data.options, origin) };
    const race = await Promise.all([ca.request('동시 로그인 1', 'POST', '/api/auth/login/verify', sameBody), ca.request('동시 로그인 2', 'POST', '/api/auth/login/verify', sameBody)]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 400]);
    const activeCookies = ca.snapshot();
    assert.equal((await ca.request('A 패스키 하나 삭제', 'DELETE', `/api/passkeys/${a1.id}`)).status, 204);
    assert.equal((await ca.request('삭제한 키의 세션 거절', 'GET', '/api/private', undefined, activeCookies)).status, 401);
    assert.equal((await login(ca, a2, '남은 A 패스키 로그인 성공')).result.status, 200);
    assert.equal((await login(ca, a1, '삭제한 A 패스키 로그인 거절')).result.status, 403);
    assert.equal((await ca.request('마지막 패스키 삭제 거절', 'DELETE', `/api/passkeys/${a2.id}`)).status, 409);
    const binding = await ca.request('브라우저 바인딩 질문', 'POST', '/api/auth/login/options', {});
    assert.equal((await anonymous.request('다른 브라우저의 질문 도용 거절', 'POST', '/api/auth/login/verify', { challengeId: binding.data.challengeId, credential: a2.login(binding.data.options, origin) })).status, 400);
    const regPending = await ca.request('로그아웃 이전 추가 등록 질문', 'POST', '/api/auth/register/options', { name: '세션 만료 키' });
    const extra = authenticator(a.id);
    await ca.request('추가 등록 중 로그아웃', 'POST', '/api/auth/logout', {});
    assert.equal((await ca.request('로그아웃 후 등록 검증 거절', 'POST', '/api/auth/register/verify', { challengeId: regPending.data.challengeId, credential: extra.register(regPending.data.options, origin) })).status, 400);
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table'").all().map(r => r.sql).join('\n');
    assert.ok(!schema.includes('private_key')); assert.ok(!schema.includes('password'));
    mkdirSync('records', { recursive: true });
    writeFileSync('records/passkey-evidence.json', JSON.stringify({ executedAt: new Date().toISOString(), environment: 'Local HTTP localhost; software WebAuthn authenticator with real P-256 signatures, not a physical device', privateKeys: 'Generated only in process memory; never sent to server or exported', requests: evidence }, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

test('public build excludes private fixtures and credentials', () => {
  function scan(path) { for (const file of readdirSync(path, { withFileTypes: true })) { const target = `${path}/${file.name}`; if (file.isDirectory()) scan(target); else if (/\.(js|html|css)$/.test(file.name)) {
    const text = readFileSync(target, 'utf8');
    for (const secret of ['작은 온습도 기록 장치의 화면', '구름 공방의 가상 모집', 'CREATE TABLE IF NOT EXISTS sessions']) assert.ok(!text.includes(secret), `${target} leaks private fixture/server schema`);
  } } }
  scan('dist');
});
