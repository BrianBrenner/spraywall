/**
 * Local stand-in for the AWS backend: the real API logic (lambda/core.ts) with
 * in-memory data, a fake Cognito (same JSON API, unsigned tokens) and local
 * photo storage. For trying the app end to end without an AWS account.
 *
 *   cd infra && npm run dev      → http://localhost:8787
 *   Owner: sign up as owner@example.com, invite code "crimp".
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { currentInvite, handle, memoryRepo, type Claims, type Deps } from '../lambda/core';

const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://localhost:${PORT}`;
const OWNER_EMAIL = process.env.DEV_OWNER ?? 'owner@example.com';

const repo = memoryRepo();
const files = new Map<string, { type: string; data: Buffer }>();
const users = new Map<string, { sub: string; email: string; name: string; password: string; createdAt: number }>();
const refreshTokens = new Map<string, string>(); // token → email

const deps: Deps = {
  repo,
  ownerEmail: OWNER_EMAIL,
  initialInvite: 'crimp',
  photos: {
    async createUpload(contentType) {
      const key = `photos/${randomUUID()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      return { uploadUrl: `${BASE}/upload/${key}`, photoUrl: `${BASE}/files/${key}` };
    },
  },
  members: {
    async list() {
      return [...users.values()].map((u) => ({ username: u.sub, name: u.name, email: u.email, createdAt: u.createdAt }));
    },
    async remove(username) {
      for (const [email, u] of users) if (u.sub === username) users.delete(email);
    },
  },
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokensFor(email: string) {
  const u = users.get(email)!;
  const claims: Claims & { exp: number } = {
    sub: u.sub,
    email: u.email,
    name: u.name,
    email_verified: 'true',
    'cognito:username': u.sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const idToken = `${b64({ alg: 'none' })}.${b64(claims)}.dev`;
  return { IdToken: idToken, AccessToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' };
}

class CognitoError extends Error {
  type: string;
  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

/** The handful of Cognito actions the app uses. */
async function cognito(target: string, body: Record<string, any>) {
  const params = body.AuthParameters ?? {};
  switch (target) {
    case 'SignUp': {
      const email = String(body.Username).toLowerCase();
      if (users.has(email)) throw new CognitoError('UsernameExistsException', 'An account with the given email already exists.');
      const invite = (await currentInvite(deps)).toLowerCase();
      if ((body.ClientMetadata?.inviteCode ?? '').trim().toLowerCase() !== invite)
        throw new CognitoError('UserLambdaValidationException', 'PreSignUp failed with error That invite code isn’t right..');
      if (String(body.Password).length < 8) throw new CognitoError('InvalidPasswordException', 'Password must be at least 8 characters.');
      const name = body.UserAttributes?.find((a: { Name: string }) => a.Name === 'name')?.Value ?? '';
      const sub = randomUUID();
      users.set(email, { sub, email, name, password: body.Password, createdAt: Date.now() });
      return { UserConfirmed: true, UserSub: sub };
    }
    case 'InitiateAuth': {
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        const email = refreshTokens.get(params.REFRESH_TOKEN);
        if (!email || !users.has(email)) throw new CognitoError('NotAuthorizedException', 'Refresh token has been revoked');
        return { AuthenticationResult: tokensFor(email) };
      }
      const email = String(params.USERNAME).toLowerCase();
      const u = users.get(email);
      if (!u || u.password !== params.PASSWORD) throw new CognitoError('NotAuthorizedException', 'Incorrect username or password.');
      const refresh = randomUUID();
      refreshTokens.set(refresh, email);
      return { AuthenticationResult: { ...tokensFor(email), RefreshToken: refresh } };
    }
    case 'ForgotPassword':
      console.log(`[dev] password reset code for ${body.Username}: 123456`);
      return { CodeDeliveryDetails: { Destination: body.Username, DeliveryMedium: 'EMAIL' } };
    case 'ConfirmForgotPassword': {
      const u = users.get(String(body.Username).toLowerCase());
      if (!u || body.ConfirmationCode !== '123456') throw new CognitoError('CodeMismatchException', 'Invalid verification code provided.');
      u.password = body.Password;
      return {};
    }
    default:
      throw new CognitoError('InvalidAction', `Dev server doesn't support ${target}`);
  }
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

function send(res: ServerResponse, status: number, body?: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-amz-target, x-amz-user-agent');
  res.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url ?? '/', BASE);
  const raw = await readBody(req);

  if (url.pathname === '/cognito') {
    try {
      const target = String(req.headers['x-amz-target'] ?? '').split('.').pop()!;
      return send(res, 200, await cognito(target, JSON.parse(raw.toString() || '{}')), 'application/x-amz-json-1.1');
    } catch (e) {
      const err = e as CognitoError;
      return send(res, 400, { __type: err.type, message: err.message }, 'application/x-amz-json-1.1');
    }
  }
  if (url.pathname.startsWith('/upload/') && req.method === 'PUT') {
    files.set(url.pathname.slice('/upload/'.length), { type: String(req.headers['content-type'] ?? 'image/jpeg'), data: raw });
    return send(res, 200);
  }
  if (url.pathname.startsWith('/files/')) {
    const f = files.get(url.pathname.slice('/files/'.length));
    return f ? send(res, 200, f.data, f.type) : send(res, 404);
  }

  // API: the same rules as production. Tokens aren't verified here (production's API Gateway does that).
  let claims: Claims | undefined;
  const auth = req.headers.authorization?.replace(/^Bearer /, '');
  if (auth && url.pathname !== '/state') {
    try {
      claims = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
    } catch {
      return send(res, 401, { message: 'Unauthorized' });
    }
  } else if (url.pathname !== '/state') {
    return send(res, 401, { message: 'Unauthorized' });
  }
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw.toString()) : undefined;
  } catch {
    return send(res, 400, { error: 'Invalid JSON.' });
  }
  const out = await handle({ method: req.method ?? 'GET', path: url.pathname, body, claims }, deps);
  send(res, out.status, out.body);
}).listen(PORT, () => {
  console.log(`Spray Wall dev backend on ${BASE} (owner: ${OWNER_EMAIL}, invite: crimp)`);
});
