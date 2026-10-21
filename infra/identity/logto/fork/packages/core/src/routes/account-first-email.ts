import { TemplateType } from '@logto/connector-kit';
import { emailRegEx } from '@logto/core-kit';
import { AccountCenterControlValue, SentinelActivityAction, SignInIdentifier, Users, VerificationType } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { buildVerificationRecordByIdAndType, insertVerificationRecord, updateVerificationRecord } from '#src/libraries/verification.js';
import { validateEmailAgainstBlocklistPolicy } from '#src/libraries/sign-in-experience/email-blocklist-policy.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { buildMessageRateGuard, withMessageRateGuard } from '#src/sentinel/message-rate-guard.js';
import { assertFirstPartyClient } from '#src/utils/assert-first-party-client.js';
import assertThat from '#src/utils/assert-that.js';
import { convertToIdentifiers } from '#src/utils/sql.js';

import { withSentinel } from './experience/classes/libraries/sentinel-guard.js';
import { createNewCodeVerificationRecord } from './experience/classes/verifications/code-verification.js';
import type { UserRouter, RouterInitArgs } from './types.js';

const { table, fields } = convertToIdentifiers(Users);

/** Existing first-party user sessions need no new email-scope consent. First attachment only. Never replaces a credential, merges users, or accepts a target user ID. */
export default function accountFirstEmailRoutes<T extends UserRouter>(...[router, tenant]: RouterInitArgs<T>) {
  const { queries, libraries, sentinel } = tenant;
  router.get('/my-account/first-email', koaGuard({
    response: z.object({ email: z.string().nullable() }), status: [200, 401, 403],
  }), async (ctx, next) => {
    await assertFirstPartyClient(queries, ctx.auth.clientId);
    assertThat(ctx.accountCenter.fields.email === AccountCenterControlValue.Edit, 'account_center.field_not_editable');
    const user = await queries.users.findUserById(ctx.auth.id);
    ctx.body = { email: user.primaryEmail };
    return next();
  });

  router.post('/my-account/first-email/start', koaGuard({
    body: z.object({ email: z.string().regex(emailRegEx).max(128) }),
    response: z.object({ verificationRecordId: z.string(), expiresAt: z.string() }),
    status: [201, 400, 401, 403, 422, 429, 501],
  }), async (ctx, next) => {
    const { id: userId, clientId: applicationId } = ctx.auth;
    await assertFirstPartyClient(queries, applicationId);
    assertThat(ctx.accountCenter.fields.email === AccountCenterControlValue.Edit, 'account_center.field_not_editable');
    const user = await queries.users.findUserById(userId);
    assertThat(user.identities['inside-telegram'] && !user.primaryEmail && !user.primaryPhone && !user.passwordEncrypted,
      new RequestError({ code: 'user.email_already_in_use', status: 422 }));
    const email = ctx.guard.body.email.trim().toLowerCase();
    const { emailBlocklistPolicy } = await queries.signInExperiences.findDefaultSignInExperience();
    await validateEmailAgainstBlocklistPolicy(emailBlocklistPolicy, email);
    // Do not disclose whether another Account owns the address before proof of ownership.
    const identifier = { type: SignInIdentifier.Email, value: email } as const;
    const verification = createNewCodeVerificationRecord(libraries, queries, identifier, TemplateType.BindNewIdentifier);
    const emailContext = await libraries.passcodes.buildVerificationCodeContext({ user, applicationId }, ctx);
    await withMessageRateGuard(await buildMessageRateGuard(queries), {
      action: SentinelActivityAction.VerificationCodeSend, recipient: email,
    }, async () => verification.sendVerificationCode({ ...ctx.emailI18n, ...emailContext }));
    const { expiresAt } = await insertVerificationRecord(verification, queries, userId);
    ctx.body = { verificationRecordId: verification.id, expiresAt: new Date(expiresAt).toISOString() };
    ctx.status = 201;
    return next();
  });

  router.post('/my-account/first-email/confirm', koaGuard({
    body: z.object({ verificationRecordId: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }),
    status: [204, 400, 401, 403, 422, 429, 501],
  }), async (ctx, next) => {
    const { id: userId, clientId } = ctx.auth;
    await assertFirstPartyClient(queries, clientId);
    assertThat(ctx.accountCenter.fields.email === AccountCenterControlValue.Edit, 'account_center.field_not_editable');
    const { verificationRecordId, code } = ctx.guard.body;
    const record = await queries.verificationRecords.findActiveVerificationRecordById(verificationRecordId);
    assertThat(record?.userId === userId, 'verification_record.not_found');
    const verification = await buildVerificationRecordByIdAndType({ type: VerificationType.EmailVerificationCode, id: verificationRecordId, queries, libraries });
    assertThat(verification.templateType === TemplateType.BindNewIdentifier, 'verification_record.not_found');
    const email = verification.identifier.value;
    if (!verification.isVerified) {
      await withSentinel({ ctx, sentinel, queries, action: SentinelActivityAction.VerificationCode,
        identifier: verification.identifier, payload: { verificationId: verification.id } }, verification.verify(verification.identifier, code));
      // Persist proof before credential mutation. A lost response can retry this same record.
      await updateVerificationRecord(verification, queries);
    }
    const user = await queries.users.findUserById(userId);
    if (user.primaryEmail === email) { ctx.status = 204; return next(); }
    assertThat(user.identities['inside-telegram'] && !user.primaryEmail && !user.primaryPhone && !user.passwordEncrypted,
      new RequestError({ code: 'user.email_already_in_use', status: 422 }));
    const { emailBlocklistPolicy } = await queries.signInExperiences.findDefaultSignInExperience();
    await validateEmailAgainstBlocklistPolicy(emailBlocklistPolicy, email);
    await libraries.users.checkIdentifierCollision({ primaryEmail: email }, userId);
    // Compare-and-set makes concurrent first attachments unable to replace each other.
    try {
      const result = await queries.pool.query(sql`update ${table} set ${fields.primaryEmail} = ${email}
        where ${fields.id} = ${userId} and ${fields.primaryEmail} is null
          and ${fields.primaryPhone} is null and ${fields.passwordEncrypted} is null`);
      if (result.rowCount === 0) {
        const current = await queries.users.findUserById(userId);
        assertThat(current.primaryEmail === email, new RequestError({ code: 'user.email_already_in_use', status: 422 }));
      }
    } catch (error) {
      // Map a uniqueness race through the same collision contract as the ordinary Account API.
      await libraries.users.checkIdentifierCollision({ primaryEmail: email }, userId);
      throw error;
    }
    const updatedUser = await queries.users.findUserById(userId);
    ctx.appendDataHookContext('User.Data.Updated', { user: updatedUser });
    ctx.status = 204;
    return next();
  });
}
