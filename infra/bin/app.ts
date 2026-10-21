import { App } from 'aws-cdk-lib';
import { SprayWallStack } from '../lib/stack';

const app = new App();
// deploy.sh exports these for every CDK command (bootstrap loads the app too); -c context still works.
const ownerEmail = process.env.SPRAYWALL_OWNER_EMAIL || app.node.tryGetContext('ownerEmail');
const initialInvite = process.env.SPRAYWALL_INVITE_CODE || app.node.tryGetContext('inviteCode');
if (!ownerEmail || !initialInvite) throw new Error('Missing owner email or invite code. Deploy with ./infra/deploy.sh from the repo root.');

new SprayWallStack(app, 'SprayWall', {
  env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT },
  ownerEmail,
  initialInvite,
  appOrigins: (app.node.tryGetContext('appOrigins') ?? 'https://brianbrenner.github.io,http://localhost:5173').split(','),
});
