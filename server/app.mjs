import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { resolve } from 'node:path';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { openStore, transaction, token, hash } from './store.mjs';

const CHALLENGE_MS = 120_000;
const SESSION_MS = 60 * 60_000;
const RECENT_MS = 10 * 60_000;
class Failure extends Error { constructor(status, code, message) { super(message); Object.assign(this, { status, code }); } }
const fail = (status, code, message) => { throw new Failure(status, code, message); };

export function createApp({ db = openStore(), origin = process.env.APP_ORIGIN || 'http://localhost:5173', staticDir = resolve('dist'), limiting = true } = {}) {
  const app = express();
  const rpID = new URL(origin).hostname;
  const secure = new URL(origin).protocol === 'https:';
  if (!secure && !['localhost', '127.0.0.1'].includes(rpID)) throw new Error('HTTPS origin required');
  const sessionCookie = secure ? '__Host-portfolio' : 'portfolio';
  const ceremonyCookie = secure ? '__Host-ceremony' : 'ceremony';
  const cookie = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  app.disable('x-powered-by');
  // Only Caddy can reach this port outside the container; trust that one proxy hop.
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"] } }, strictTransportSecurity: secure ? { maxAge: 31536000 } : false }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) return next(new Failure(403, 'ORIGIN_REJECTED', '허용되지 않은 출처의 요청입니다.'));
    next();
  });
  if (limiting) {
    app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { code: 'RATE_LIMIT', error: '요청이 많습니다. 1분 뒤 다시 시도해 주세요.' } }));
  }
  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); });

  function session(req) {
    const value = req.cookies[sessionCookie];
    if (typeof value !== 'string') return null;
    return db.prepare('SELECT s.*, u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?').get(hash(value), Date.now()) || null;
  }
  function requireSession(req) {
    const s = session(req);
    if (!s) fail(401, 'LOGIN_REQUIRED', '패스키로 먼저 로그인해 주세요.');
    return s;
  }
  function recent(s) {
    if (Date.now() - s.created_at > RECENT_MS) fail(401, 'REAUTH_REQUIRED', '패스키 관리를 위해 다시 로그인해 주세요.');
  }
  function issueSession(res, userId, credentialId, req) {
    const value = token();
    transaction(db, () => {
      if (req.cookies[sessionCookie]) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hash(req.cookies[sessionCookie]));
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(hash(value), userId, credentialId, Date.now(), Date.now() + SESSION_MS);
    });
    res.cookie(sessionCookie, value, { ...cookie, maxAge: SESSION_MS });
  }
  function cleanup() {
    db.prepare('DELETE FROM challenges WHERE expires_at<=?').run(Date.now());
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('DELETE FROM invitations WHERE expires_at<=?').run(Date.now());
  }
  function challenge(req, res, purpose, options, details = {}) {
    cleanup();
    let browser = req.cookies[ceremonyCookie];
    if (typeof browser !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(browser)) browser = token();
    res.cookie(ceremonyCookie, browser, { ...cookie, maxAge: SESSION_MS });
    const id = token();
    db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, hash(browser), purpose, options.challenge,
      details.userId || null, details.invitationHash || null, details.sessionHash || null, details.name || null, Date.now() + CHALLENGE_MS);
    res.json({ challengeId: id, options });
  }
  function consume(req, purpose) {
    const { challengeId } = req.body;
    const browser = req.cookies[ceremonyCookie];
    if (typeof challengeId !== 'string' || typeof browser !== 'string') fail(400, 'CHALLENGE_INVALID', '인증 요청이 없거나 만료되었습니다. 다시 시작해 주세요.');
    // Atomic delete makes concurrent replay fail before any signature verification.
    const c = db.prepare('DELETE FROM challenges WHERE id=? AND browser_hash=? AND purpose=? RETURNING *').get(challengeId, hash(browser), purpose);
    if (!c || c.expires_at <= Date.now()) fail(400, 'CHALLENGE_INVALID', '이미 사용했거나 만료된 인증 요청입니다. 다시 시작해 주세요.');
    return c;
  }
  function registrationGrant(req) {
    const s = session(req);
    if (s) { recent(s); return { userId: s.user_id, sessionHash: s.id_hash }; }
    if (typeof req.body.invitation !== 'string') fail(401, 'INVITATION_REQUIRED', '처음 등록할 때는 소유자의 일회용 등록 링크가 필요합니다.');
    const invitationHash = hash(req.body.invitation);
    const i = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(invitationHash, Date.now());
    if (!i || db.prepare('SELECT 1 FROM credentials WHERE user_id=?').get(i.user_id)) fail(403, 'INVITATION_INVALID', '사용했거나 만료된 등록 링크입니다.');
    return { userId: i.user_id, invitationHash };
  }
  const credentialsFor = id => db.prepare('SELECT * FROM credentials WHERE user_id=? ORDER BY created_at').all(id);

  app.get('/api/session', (req, res) => {
    const s = session(req);
    res.json({ user: s ? { id: s.user_id, name: s.name } : null });
  });
  app.post('/api/auth/register/options', async (req, res) => {
    const grant = registrationGrant(req);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) fail(400, 'NAME_REQUIRED', '패스키 이름을 1~80자로 입력해 주세요.');
    const existing = credentialsFor(grant.userId);
    if (existing.length >= 10) fail(409, 'KEY_LIMIT', '패스키는 최대 10개까지 등록할 수 있습니다.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(grant.userId);
    const options = await generateRegistrationOptions({ rpName: 'One Link · 나만의 공간', rpID, userID: Buffer.from(user.id, 'base64url'),
      userName: user.name, userDisplayName: user.name, attestationType: 'none',
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map(c => ({ id: c.id, transports: JSON.parse(c.transports) })), timeout: CHALLENGE_MS });
    challenge(req, res, 'registration', options, { ...grant, name });
  });
  app.post('/api/auth/register/verify', async (req, res) => {
    const c = consume(req, 'registration');
    let result;
    try { result = await verifyRegistrationResponse({ response: req.body.credential, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
    catch { fail(403, 'REGISTRATION_FAILED', '패스키 등록을 검증하지 못했습니다. 다시 시도해 주세요.'); }
    if (!result.verified || !result.registrationInfo) fail(403, 'REGISTRATION_FAILED', '패스키 등록을 검증하지 못했습니다.');
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    transaction(db, () => {
      if (c.invitation_hash) {
        const i = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND user_id=? AND expires_at>?').get(c.invitation_hash, c.user_id, Date.now());
        if (!i || credentialsFor(c.user_id).length) fail(403, 'INVITATION_INVALID', '사용했거나 만료된 등록 링크입니다.');
        db.prepare('DELETE FROM invitations WHERE token_hash=?').run(c.invitation_hash);
      } else {
        const s = requireSession(req); recent(s);
        if (s.id_hash !== c.session_hash || s.user_id !== c.user_id) fail(403, 'SESSION_CHANGED', '등록을 시작한 로그인 상태가 아닙니다.');
      }
      if (credentialsFor(c.user_id).length >= 10) fail(409, 'KEY_LIMIT', '패스키는 최대 10개까지 등록할 수 있습니다.');
      if (db.prepare('SELECT 1 FROM credentials WHERE id=?').get(credential.id)) fail(409, 'KEY_EXISTS', '이미 등록된 패스키입니다.');
      db.prepare('INSERT INTO credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(credential.id, c.user_id, credential.publicKey, credential.counter,
        JSON.stringify(credential.transports || []), c.name, credentialDeviceType, Number(credentialBackedUp), Date.now());
    });
    issueSession(res, c.user_id, credential.id, req);
    res.status(201).json({ verified: true });
  });
  app.post('/api/auth/login/options', async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: CHALLENGE_MS });
    challenge(req, res, 'authentication', options);
  });
  app.post('/api/auth/login/verify', async (req, res) => {
    const c = consume(req, 'authentication');
    const response = req.body.credential;
    const key = typeof response?.id === 'string' ? db.prepare('SELECT * FROM credentials WHERE id=?').get(response.id) : null;
    if (!key) fail(403, 'AUTHENTICATION_FAILED', '등록되지 않았거나 삭제된 패스키입니다.');
    if (response.response?.userHandle && response.response.userHandle !== key.user_id) fail(403, 'AUTHENTICATION_FAILED', '계정과 패스키가 일치하지 않습니다.');
    let result;
    try { result = await verifyAuthenticationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) } }); }
    catch { fail(403, 'AUTHENTICATION_FAILED', '패스키 서명을 확인하지 못했습니다.'); }
    if (!result.verified) fail(403, 'AUTHENTICATION_FAILED', '패스키 서명을 확인하지 못했습니다.');
    // Compare-and-update detects deletion or a racing signature-counter change during async verification.
    const updated = db.prepare('UPDATE credentials SET counter=? WHERE id=? AND counter=?').run(result.authenticationInfo.newCounter, key.id, key.counter);
    if (!updated.changes) fail(403, 'AUTHENTICATION_FAILED', '패스키 상태가 바뀌었습니다. 다시 로그인해 주세요.');
    issueSession(res, key.user_id, key.id, req);
    res.json({ verified: true });
  });
  app.post('/api/auth/cancel', (req, res) => {
    if (typeof req.body.challengeId === 'string' && typeof req.cookies[ceremonyCookie] === 'string')
      db.prepare('DELETE FROM challenges WHERE id=? AND browser_hash=?').run(req.body.challengeId, hash(req.cookies[ceremonyCookie]));
    res.status(204).end();
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.cookies[sessionCookie]) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hash(req.cookies[sessionCookie]));
    if (req.cookies[ceremonyCookie]) db.prepare('DELETE FROM challenges WHERE browser_hash=?').run(hash(req.cookies[ceremonyCookie]));
    res.clearCookie(sessionCookie, cookie); res.clearCookie(ceremonyCookie, cookie); res.status(204).end();
  });
  function privateNotes(req, res) {
    const s = requireSession(req);
    if (req.params.userId && req.params.userId !== s.user_id) fail(403, 'NOT_YOUR_DATA', '다른 계정의 비공개 자료에는 접근할 수 없습니다.');
    // Query/body userId is deliberately ignored: ownership comes only from the server-side session.
    res.json({ ownerId: s.user_id, fictional: true, notes: db.prepare('SELECT id,title,body FROM notes WHERE user_id=? ORDER BY rowid').all(s.user_id) });
  }
  app.get('/api/private', privateNotes);
  app.post('/api/private', privateNotes);
  app.get('/api/users/:userId/private', privateNotes);
  app.get('/api/passkeys', (req, res) => {
    const s = requireSession(req);
    res.json({ keys: credentialsFor(s.user_id).map(c => ({ id: c.id, name: c.name, createdAt: new Date(c.created_at).toISOString(),
      current: c.id === s.credential_id, deviceType: c.device_type, backedUp: Boolean(c.backed_up), publicKey: Buffer.from(c.public_key).toString('base64url') })) });
  });
  app.delete('/api/passkeys/:id', (req, res) => {
    const s = requireSession(req); recent(s);
    transaction(db, () => {
      const c = db.prepare('SELECT * FROM credentials WHERE id=? AND user_id=?').get(req.params.id, s.user_id);
      if (!c) fail(403, 'NOT_YOUR_KEY', '이 계정의 패스키가 아닙니다.');
      if (credentialsFor(s.user_id).length <= 1) fail(409, 'LAST_KEY', '마지막 패스키는 삭제할 수 없습니다. 먼저 다른 패스키를 등록해 주세요.');
      db.prepare('DELETE FROM credentials WHERE id=? AND user_id=?').run(c.id, s.user_id);
    });
    res.status(204).end();
  });
  app.use('/api', (_req, _res, next) => next(new Failure(404, 'NOT_FOUND', '없는 요청 경로입니다.')));
  app.get(['/private', '/private/'], (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(resolve(staticDir, 'index.html')); });
  app.use(express.static(staticDir, { dotfiles: 'deny', setHeaders: (res, path) => { res.set('Cache-Control', path.includes('/assets/') || path.includes('\\assets\\') ? 'public, max-age=31536000, immutable' : 'no-cache'); } }));
  app.use((error, _req, res, _next) => {
    if (!(error instanceof Failure) && error.status !== 400 && error.status !== 413) console.error('Request failed:', error.name);
    const status = error.status || 500;
    res.status(status).json({ code: error.code || 'REQUEST_FAILED', error: error instanceof Failure ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  });
  return app;
}
