import { useSyncExternalStore } from 'react';
import { backend } from './config';

/**
 * Accounts via Amazon Cognito's JSON API (no SDK). Email + password; the server
 * confirms anyone with the current invite code on the spot. Sessions last a year
 * per device (the refresh token), with short-lived ID tokens renewed as needed.
 */

export interface Session {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  sub: string;
  email: string;
  name: string;
  /** Filled in from the server after sign-in. */
  isOwner?: boolean;
}

const KEY = 'spraywall-session';
let session: Session | null = load();
const listeners = new Set<() => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(next: Session | null) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing: stays signed in for this tab only.
  }
  listeners.forEach((l) => l());
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}

export const currentSession = () => session;

/** Turn Cognito's error codes into something a climber can act on. */
function friendly(type: string, message: string) {
  if (type.includes('UserLambdaValidation')) return message.replace(/^PreSignUp failed with error /, '').replace(/\.+$/, '.');
  if (type.includes('UsernameExists')) return 'There’s already an account with that email. Try signing in.';
  if (type.includes('NotAuthorized')) return 'Wrong email or password.';
  if (type.includes('UserNotFound')) return 'Wrong email or password.';
  if (type.includes('InvalidPassword')) return 'Use a password of at least 8 characters.';
  if (type.includes('CodeMismatch')) return 'That code isn’t right.';
  if (type.includes('ExpiredCode')) return 'That code has expired. Ask for a new one.';
  if (type.includes('LimitExceeded') || type.includes('TooManyRequests')) return 'Too many tries. Wait a few minutes and try again.';
  return message || 'Something went wrong.';
}

async function cognito<T>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!backend) throw new Error('No server is set up.');
  const res = await fetch(backend.cognitoEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify({ ClientId: backend.userPoolClientId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(String(data.__type ?? ''), String(data.message ?? '')));
  return data as T;
}

interface AuthResult {
  AuthenticationResult: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
}

function claimsOf(idToken: string) {
  const json = atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decodeURIComponent(escape(json))) as { sub: string; email?: string; name?: string };
}

function sessionFrom(result: AuthResult['AuthenticationResult'], refreshToken: string, previous?: Session | null): Session {
  const c = claimsOf(result.IdToken);
  return {
    idToken: result.IdToken,
    refreshToken,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
    sub: c.sub,
    email: c.email ?? '',
    name: c.name ?? '',
    isOwner: previous?.sub === c.sub ? previous.isOwner : undefined,
  };
}

export async function signIn(email: string, password: string) {
  const r = await cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email.trim().toLowerCase(), PASSWORD: password },
  });
  setSession(sessionFrom(r.AuthenticationResult, r.AuthenticationResult.RefreshToken!));
}

export async function signUp(name: string, email: string, password: string, inviteCode: string) {
  await cognito('SignUp', {
    Username: email.trim().toLowerCase(),
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email.trim().toLowerCase() },
      { Name: 'name', Value: name.trim() },
    ],
    ClientMetadata: { inviteCode: inviteCode.trim() },
  });
  await signIn(email, password);
}

export function signOut() {
  setSession(null);
}

export async function requestPasswordReset(email: string) {
  await cognito('ForgotPassword', { Username: email.trim().toLowerCase() });
}

export async function resetPassword(email: string, code: string, password: string) {
  await cognito('ConfirmForgotPassword', { Username: email.trim().toLowerCase(), ConfirmationCode: code.trim(), Password: password });
  await signIn(email, password);
}

export function setOwner(isOwner: boolean) {
  if (session && session.isOwner !== isOwner) setSession({ ...session, isOwner });
}

let refreshing: Promise<void> | null = null;

/** A valid ID token for API calls, renewing it if it's about to expire. Signs out if the account is gone. */
export async function idToken(): Promise<string | null> {
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.idToken;
  refreshing ??= (async () => {
    const s = session!;
    try {
      const r = await cognito<AuthResult>('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: s.refreshToken },
      });
      setSession(sessionFrom(r.AuthenticationResult, s.refreshToken, s));
    } catch (e) {
      if (navigator.onLine) setSession(null);
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session?.idToken ?? null;
}
