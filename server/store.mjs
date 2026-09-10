import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

export function openStore(path = process.env.DB_PATH || './data/portfolio.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS notes_owner ON notes(user_id);
    CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, name TEXT NOT NULL,
      device_type TEXT NOT NULL, backed_up INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS credentials_owner ON credentials(user_id);
    CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS invitations (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, purpose TEXT NOT NULL,
      challenge TEXT NOT NULL, user_id TEXT, invitation_hash TEXT, session_hash TEXT, name TEXT, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
    PRAGMA optimize;`);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function provision(db, name, origin, variant = 'owner') {
  const id = token();
  const invite = token();
  transaction(db, () => {
    db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(id, name, Date.now());
    const samples = variant === 'owner'
      ? [['준비 중인 프로젝트', '가상 메모: 작은 온습도 기록 장치의 화면 구성을 다음 주에 실험합니다.'], ['지원 준비 목록', '가상 메모: 별빛 연구소와 파도 스튜디오의 가상 채용 과제를 비교합니다.'], ['이번 주 회고', '가상 메모: 한 번에 한 조건을 바꾸고, 결과를 기록하는 습관을 이어갑니다.']]
      : [['검증 계정 프로젝트', '가상 검증 메모: 종이비행기 거리 측정 화면을 구상합니다.'], ['검증 계정 준비 목록', '가상 검증 메모: 구름 공방의 가상 모집 안내를 정리합니다.'], ['검증 계정 회고', '가상 검증 메모: 다른 계정의 자료와 섞이지 않아야 합니다.']];
    for (const [title, body] of samples) db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?)').run(token(), id, title, body);
    db.prepare('INSERT INTO invitations VALUES (?, ?, ?)').run(hash(invite), id, Date.now() + 24 * 60 * 60 * 1000);
  });
  return { id, name, url: `${origin}/private#enroll=${invite}` };
}
