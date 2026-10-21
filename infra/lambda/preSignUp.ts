import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { currentInvite } from './core';
import { dynamoRepo } from './dynamo';

const repo = dynamoRepo(process.env.TABLE_NAME!);

/**
 * Cognito pre sign-up hook: only people with the current invite code can make
 * an account. Valid sign-ups are confirmed on the spot (no verification email).
 */
export async function handler(event: PreSignUpTriggerEvent) {
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;
  const given = (event.request.clientMetadata?.inviteCode ?? '').trim().toLowerCase();
  const expected = (await currentInvite({ repo, initialInvite: process.env.INITIAL_INVITE ?? '' })).trim().toLowerCase();
  if (!expected || given !== expected) throw new Error('That invite code isn’t right.');
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}
