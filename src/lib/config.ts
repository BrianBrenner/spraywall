import awsConfig from '../aws-config.json';

/** Where the shared backend lives. `null` means local-only mode (everything stays on this device). */
export interface Backend {
  apiUrl: string;
  userPoolClientId: string;
  cognitoEndpoint: string;
}

interface AwsConfig {
  region?: string;
  apiUrl?: string;
  userPoolClientId?: string;
}

function resolve(): Backend | null {
  // `npm run dev:server` points the app at the local stand-in backend (infra/dev/server.ts).
  if (import.meta.env.VITE_BACKEND === 'dev') {
    return { apiUrl: 'http://localhost:8787', userPoolClientId: 'dev', cognitoEndpoint: 'http://localhost:8787/cognito' };
  }
  const cfg = awsConfig as AwsConfig;
  if (!cfg.apiUrl || !cfg.userPoolClientId || !cfg.region) return null;
  return {
    apiUrl: cfg.apiUrl.replace(/\/$/, ''),
    userPoolClientId: cfg.userPoolClientId,
    cognitoEndpoint: `https://cognito-idp.${cfg.region}.amazonaws.com/`,
  };
}

export const backend = resolve();
