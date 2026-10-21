import { App } from 'aws-cdk-lib';
import { SprayWallStack } from '../lib/stack';

const app = new App();
const ownerEmail = app.node.tryGetContext('ownerEmail');
const initialInvite = app.node.tryGetContext('inviteCode');
if (!ownerEmail || !initialInvite) throw new Error('Run ./infra/deploy.sh (it passes ownerEmail and inviteCode).');

new SprayWallStack(app, 'SprayWall', {
  env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT },
  ownerEmail,
  initialInvite,
  appOrigins: (app.node.tryGetContext('appOrigins') ?? 'https://brianbrenner.github.io,http://localhost:5173').split(','),
});
