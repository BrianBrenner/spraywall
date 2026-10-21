import { randomUUID } from 'node:crypto';
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handle, type Claims, type Deps, type Member } from './core';
import { dynamoRepo } from './dynamo';

const env = process.env as Record<string, string>;
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});

const deps: Deps = {
  repo: dynamoRepo(env.TABLE_NAME),
  ownerEmail: env.OWNER_EMAIL,
  initialInvite: env.INITIAL_INVITE,
  photos: {
    async createUpload(contentType) {
      const key = `photos/${randomUUID()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      const uploadUrl = await getSignedUrl(
        s3,
        // Only Content-Type is signed, so the browser upload just sends that header.
        new PutObjectCommand({ Bucket: env.PHOTO_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn: 600 },
      );
      return { uploadUrl, photoUrl: `${env.PHOTO_CDN_URL}/${key}` };
    },
  },
  members: {
    async list() {
      const members: Member[] = [];
      let token: string | undefined;
      do {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: env.USER_POOL_ID, PaginationToken: token }));
        for (const u of res.Users ?? []) {
          const attr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value ?? '';
          members.push({ username: u.Username!, name: attr('name'), email: attr('email'), createdAt: u.UserCreateDate?.getTime() ?? 0 });
        }
        token = res.PaginationToken;
      } while (token);
      return members.sort((a, b) => a.name.localeCompare(b.name));
    },
    async remove(username) {
      await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: env.USER_POOL_ID, Username: username }));
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: username }));
    },
  },
};

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : undefined;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON.' }) };
  }
  const claims = event.requestContext.authorizer?.jwt?.claims as unknown as Claims | undefined;
  const res = await handle({ method: event.requestContext.http.method, path: event.rawPath, body, claims }, deps);
  return {
    statusCode: res.status,
    headers: { 'content-type': 'application/json' },
    body: res.body === undefined ? '' : JSON.stringify(res.body),
  };
}
