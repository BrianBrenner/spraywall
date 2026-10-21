import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ClimbThumb, GradeChip, PageHeader } from '../components/ui';
import { db } from '../db';
import { requestPasswordReset, resetPassword, signIn, signOut, signUp, useSession, type Session } from '../lib/auth';
import { setClimbQueue } from '../lib/hooks';
import { pull, refreshMe } from '../lib/mutations';

export function ProfilePage() {
  const session = useSession();
  return (
    <>
      <PageHeader title="Profile" large />
      <div className="page-body profile">{session ? <SignedIn session={session} /> : <SignedOut />}</div>
    </>
  );
}

type Mode = 'signIn' | 'signUp' | 'forgot' | 'reset';

function SignedOut() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const afterSignIn = async () => {
    await refreshMe();
    pull().catch(() => {});
  };

  const submit = () =>
    run(async () => {
      if (mode === 'signIn') await signIn(email, password).then(afterSignIn);
      else if (mode === 'signUp') await signUp(name, email, password, invite).then(afterSignIn);
      else if (mode === 'forgot') {
        await requestPasswordReset(email);
        setInfo(`If there’s an account for ${email}, we’ve emailed it a code.`);
        setMode('reset');
      } else await resetPassword(email, code, password).then(afterSignIn);
    });

  const titles: Record<Mode, string> = {
    signIn: 'Sign in',
    signUp: 'Create an account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  };

  return (
    <div className="auth-card card">
      <h2>{titles[mode]}</h2>
      <p className="muted">
        {mode === 'signUp'
          ? 'You’ll need the invite code from the wall owner.'
          : mode === 'signIn'
            ? 'Sign in to set climbs and tick the ones you send. You can browse without an account.'
            : info || 'We’ll email you a code to reset it.'}
      </p>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {mode === 'signUp' && (
          <label>
            Your name
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode === 'reset' && (
          <label>
            Code from the email
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
        )}
        {mode !== 'forgot' && (
          <label>
            {mode === 'reset' ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        )}
        {mode === 'signUp' && (
          <label>
            Invite code
            <input autoCapitalize="none" autoCorrect="off" value={invite} onChange={(e) => setInvite(e.target.value)} required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'One moment…' : titles[mode]}
        </button>
      </form>
      <div className="auth-links">
        {mode === 'signIn' ? (
          <>
            <button type="button" className="link-btn" onClick={() => setMode('signUp')}>Create an account</button>
            <button type="button" className="link-btn" onClick={() => setMode('forgot')}>Forgot password?</button>
          </>
        ) : (
          <button type="button" className="link-btn" onClick={() => { setMode('signIn'); setError(''); }}>Back to sign in</button>
        )}
      </div>
    </div>
  );
}

function SignedIn({ session }: { session: Session }) {
  const navigate = useNavigate();
  const log = useLiveQuery(async () => {
    const ticks = await db.ticks.where('userId').equals(session.sub).toArray();
    ticks.sort((a, b) => b.date - a.date);
    const climbs = await db.climbs.bulkGet(ticks.map((t) => t.climbId));
    return ticks.flatMap((t, i) => (climbs[i] ? [{ tick: t, climb: climbs[i]! }] : []));
  }, [session.sub]);

  return (
    <>
      <div className="card profile-card">
        <div className="avatar">{(session.name || session.email).slice(0, 1).toUpperCase()}</div>
        <div className="profile-text">
          <strong>
            {session.name || 'Climber'}
            {session.isOwner && <span className="badge accent">Owner</span>}
          </strong>
          <span className="muted small">{session.email}</span>
        </div>
        <button type="button" className="btn ghost" onClick={signOut}>
          <Icon name="logout" size={18} /> Sign out
        </button>
      </div>

      <section className="section">
        <h2 className="section-title">Logbook{log?.length ? ` · ${log.length}` : ''}</h2>
        {log?.length === 0 && <p className="muted">No ticks yet. Open a climb and tap ✓ when you send it.</p>}
        <ul className="climb-list">
          {log?.map(({ tick, climb }) => (
            <li key={tick.id} className="climb-row">
              <button
                type="button"
                className="climb-row-main"
                onClick={() => {
                  setClimbQueue(log.map((l) => l.climb.id));
                  navigate(`/climbs/${climb.id}`);
                }}
              >
                <ClimbThumb climb={climb} />
                <div className="climb-row-text">
                  <div className="climb-row-title">
                    <span className="climb-name">{climb.name || 'Untitled'}</span>
                    <GradeChip grade={climb.grade} />
                  </div>
                  <div className="tick-summary">
                    <span>{new Date(tick.date).toLocaleDateString()}</span>
                    {tick.stars > 0 && <span className="stars">{'★'.repeat(tick.stars)}</span>}
                    {tick.grade && tick.grade !== climb.grade && <span>felt {tick.grade}</span>}
                  </div>
                  {tick.note && <div className="muted small">{tick.note}</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
