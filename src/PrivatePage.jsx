import { useEffect, useState } from 'react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const enrollment = new URLSearchParams(window.location.hash.slice(1)).get('enroll') || '';
if (enrollment) window.history.replaceState(null, '', window.location.pathname);

async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) { const error = new Error(body?.error || '서버에 연결하지 못했습니다.'); error.code = body?.code; error.status = response.status; throw error; }
  return body;
}

export default function PrivatePage() {
  const [user, setUser] = useState(null);
  const [notes, setNotes] = useState([]);
  const [keys, setKeys] = useState([]);
  const [invitation, setInvitation] = useState(enrollment);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const supported = window.isSecureContext && browserSupportsWebAuthn();
  const clearPrivate = () => { setUser(null); setNotes([]); setKeys([]); setDeleting(null); };

  async function refresh() {
    const session = await api('/session');
    if (!session.user) { clearPrivate(); return; }
    const [privateData, passkeys] = await Promise.all([api('/private'), api('/passkeys')]);
    setUser(session.user); setNotes(privateData.notes); setKeys(passkeys.keys);
  }
  useEffect(() => {
    const check = () => refresh().catch(error => { clearPrivate(); setMessage(error.message); }).finally(() => setLoading(false));
    check();
    const timer = setInterval(check, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  async function authenticate(register = false) {
    if (busy) return;
    setBusy(true); setMessage('기기의 패스키 창에서 본인 확인을 완료해 주세요.');
    let challengeId;
    try {
      const flow = register ? 'register' : 'login';
      const challenge = await api(`/auth/${flow}/options`, register ? { name, invitation } : {});
      challengeId = challenge.challengeId;
      const credential = register ? await startRegistration({ optionsJSON: challenge.options }) : await startAuthentication({ optionsJSON: challenge.options });
      await api(`/auth/${flow}/verify`, { challengeId, credential });
      if (register) { setInvitation(''); setName(''); }
      await refresh();
      setMessage(register ? '패스키를 등록했습니다. 서버에는 공개키만 저장됩니다.' : '패스키를 확인했습니다. 나만의 공간이 열렸습니다.');
    } catch (error) {
      if (challengeId) await api('/auth/cancel', { challengeId }).catch(() => {});
      if (error.status === 401) clearPrivate();
      setMessage(error.name === 'NotAllowedError' || error.code === 'ERROR_CEREMONY_ABORTED'
        ? '본인 확인을 취소했거나 시간이 지났습니다. 새 패스키는 저장되지 않았습니다. 다시 시도할 수 있습니다.'
        : error.name === 'InvalidStateError' ? '이미 등록된 패스키입니다. 다른 기기나 보안 키를 선택해 주세요.' : error.message || '패스키를 확인하지 못했습니다. 다시 시도해 주세요.');
    } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await api('/auth/logout', {}); clearPrivate(); setMessage('로그아웃했습니다. 이전 로그인 세션은 더 이상 사용할 수 없습니다.'); }
    catch (error) { clearPrivate(); setMessage(`화면은 잠겼지만 서버 로그아웃을 확인하지 못했습니다. ${error.message}`); }
    finally { setBusy(false); }
  }
  async function removeKey(id) {
    setBusy(true);
    try { await api(`/passkeys/${encodeURIComponent(id)}`, undefined, 'DELETE'); await refresh(); setMessage('패스키를 삭제했습니다. 삭제한 키로 로그인한 세션도 종료됩니다.'); setDeleting(null); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <>
    <header className="verification-header">
      <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">01</span><span>ONE LINK</span></a>
      <a className="back-link" href="/">공개 소개로 돌아가기</a>
    </header>
    <main id="main-content" className="vault-main">
      <div className="vault-heading"><div><p className="eyebrow">PRIVATE · PASSKEY</p><h1>나만의 공간</h1></div><span className={`vault-state ${user ? 'open' : ''}`}>{user ? '열림' : '잠김'}</span></div>
      <p className="vault-intro">공개 소개와 분리된 개인 메모입니다. 이곳에 저장된 메모와 기관 이름은 모두 과제용으로 만든 내용입니다.</p>
      <p className="vault-message" role="status" aria-live="polite">{loading ? '로그인 상태를 확인하고 있습니다.' : message || (user ? `${user.name} 계정으로 열었습니다.` : '패스키로 본인 확인을 하면 메모를 볼 수 있습니다.')}</p>
      {!loading && !user && <section className="vault-lock" aria-labelledby="lock-title">
        <div className="lock-symbol" aria-hidden="true">◎</div>
        <h2 id="lock-title">열쇠는 내 기기에</h2>
        <p>지문·얼굴·기기 PIN으로 확인합니다.<br />이 사이트의 비밀번호는 만들지 않습니다.</p>
        <button className="vault-button" disabled={busy || !supported} onClick={() => authenticate(false)}>{busy ? '본인 확인 중…' : '패스키로 들어가기'}</button>
        {!supported && <p role="alert">패스키를 지원하는 최신 브라우저에서 HTTPS 주소로 접속해 주세요.</p>}
        {!invitation && <p className="vault-help">처음 사용하는 소유자는 전달받은 일회용 등록 링크를 열어 주세요.</p>}
      </section>}
      {!loading && user && <>
        <div className="vault-toolbar"><p><strong>{user.name}</strong>의 메모 · {notes.length}개</p><div><button className="vault-button secondary" disabled={busy} onClick={() => authenticate(false)}>패스키로 다시 확인</button><button className="vault-button secondary" disabled={busy} onClick={logout}>로그아웃</button></div></div>
        <section className="vault-notes" aria-label="비공개 메모">{notes.map((note, index) => <article className="vault-note" key={note.id}><span>0{index + 1} · 가상 메모</span><h2>{note.title}</h2><p>{note.body}</p></article>)}</section>
        <section className="vault-keys" aria-labelledby="keys-title"><div className="vault-section-title"><h2 id="keys-title">내 패스키</h2><span>{keys.length}개 등록됨</span></div>
          <p>서로 다른 기기나 보안 키에 두 개를 준비하세요. 같은 비밀번호 관리자에서 동기화된 패스키 하나는 두 개로 세지 않습니다.</p>
          <ul>{keys.map(key => <li key={key.id}><div><strong>{key.name}</strong>{key.current && <span className="key-current">이번 로그인에 사용</span>}<p>{new Date(key.createdAt).toLocaleString('ko-KR')} 등록</p>
            <details><summary>서버에 저장된 공개키 보기</summary><p>COSE 공개키를 base64url로 표시합니다. 비밀번호나 개인키가 아닙니다.</p><code>{key.publicKey}</code></details></div>
            {deleting === key.id ? <div className="key-confirm"><p>이 패스키를 삭제할까요?</p><button className="vault-button danger" disabled={busy} onClick={() => removeKey(key.id)}>삭제 확인</button><button className="vault-button secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</button></div>
              : <button className="vault-button secondary" disabled={busy || keys.length < 2} onClick={() => setDeleting(key.id)}>삭제</button>}</li>)}</ul>
        </section>
      </>}
      {!loading && (user || invitation) && <section className="vault-register" aria-labelledby="register-title"><h2 id="register-title">{user ? '다른 패스키 추가' : '첫 패스키 등록'}</h2><p>{user ? '등록할 기기를 구분할 수 있는 이름을 붙여 주세요.' : '소유자에게 전달된 일회용 링크로 계정에 첫 패스키를 연결합니다.'}</p>
        <form onSubmit={event => { event.preventDefault(); authenticate(true); }}><label htmlFor="key-name">패스키 이름</label><div><input id="key-name" value={name} maxLength={80} required autoComplete="off" placeholder="예: 내 노트북 · 보안 키" onChange={event => setName(event.target.value)} disabled={busy} /><button className="vault-button" disabled={busy || !supported || !name.trim()}>{busy ? '등록 중…' : '패스키 등록'}</button></div></form>
      </section>}
      <aside className="vault-policy"><h2>기기를 잃어버렸다면</h2><p>남아 있는 패스키로 로그인하고 잃어버린 키를 삭제하세요. 마지막 패스키는 삭제할 수 없습니다. 사용할 수 있는 패스키를 모두 잃으면 웹에서는 복구할 수 없으며, 서버 관리자가 소유자를 별도로 확인해야 합니다.</p><a href="/submission.html">인증 구현 설명서와 확인 기록</a></aside>
    </main>
    <footer className="verification-footer"><span>ONE LINK · PRIVATE SPACE</span><a href="/">공개 소개</a></footer>
  </>;
}
