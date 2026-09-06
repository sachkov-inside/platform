// oxlint-disable-next-line no-unused-vars
const getCustomJwtClaims = async ({ token, context }) => {
  if (token.gty !== 'authorization_code') {
    return {};
  }

  const telegramVerification = context.interaction?.verificationRecords?.find(
    (record) => record.type === 'Social' &&
      record.connectorId === '__INSIDE_TELEGRAM_CONNECTOR_ID__' &&
      record.socialUserInfo?.id === context.user?.identities?.['inside-telegram']?.userId &&
      typeof record.socialUserInfo?.rawData?.requestRef === 'string'
  );
  if (telegramVerification) {
    return { inside_telegram_sign_in: {
      subjectRef: telegramVerification.socialUserInfo.id,
      requestRef: telegramVerification.socialUserInfo.rawData.requestRef,
    } };
  }

  const emailVerification = context.interaction?.verificationRecords?.find(
    (record) =>
      record.type === 'EmailVerificationCode' &&
      record.verified === true &&
      record.identifier?.type === 'email'
  );
  const verifiedEmail = emailVerification?.identifier?.value;
  const primaryEmail = context.user?.primaryEmail;

  if (
    typeof verifiedEmail !== 'string' ||
    typeof primaryEmail !== 'string' ||
    verifiedEmail.trim().toLocaleLowerCase('en-US') !==
      primaryEmail.trim().toLocaleLowerCase('en-US')
  ) {
    return {};
  }

  return {
    inside_verified_email: verifiedEmail,
  };
};
