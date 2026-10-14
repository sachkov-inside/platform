// oxlint-disable-next-line no-unused-vars
const getCustomJwtClaims = async ({ token, context }) => {
  const primaryEmail = context?.user?.primaryEmail;
  const receiptClaims = typeof primaryEmail === 'string' && primaryEmail.trim().length > 0 &&
    (token.gty === 'authorization_code' || token.gty === 'refresh_token')
    ? { inside_receipt_email: primaryEmail.trim().toLocaleLowerCase('en-US') }
    : {};
  // Receipt contact is not a fresh proof of identity establishment.
  if (token.gty !== 'authorization_code') {
    return receiptClaims;
  }

  const telegramVerification = context?.interaction?.verificationRecords?.find(
    (record) => record.type === 'Social' &&
      record.connectorId === '__INSIDE_TELEGRAM_CONNECTOR_ID__' &&
      record.socialUserInfo?.id === context?.user?.identities?.['inside-telegram']?.userId &&
      typeof record.socialUserInfo?.rawData?.requestRef === 'string'
  );
  if (telegramVerification) {
    return { ...receiptClaims, inside_telegram_sign_in: {
      subjectRef: telegramVerification.socialUserInfo.id,
      requestRef: telegramVerification.socialUserInfo.rawData.requestRef,
    } };
  }

  const emailVerification = context?.interaction?.verificationRecords?.find(
    (record) =>
      record.type === 'EmailVerificationCode' &&
      record.verified === true &&
      record.identifier?.type === 'email'
  );
  const verifiedEmail = emailVerification?.identifier?.value;

  if (
    typeof verifiedEmail !== 'string' ||
    typeof primaryEmail !== 'string' ||
    verifiedEmail.trim().toLocaleLowerCase('en-US') !==
      primaryEmail.trim().toLocaleLowerCase('en-US')
  ) {
    return receiptClaims;
  }

  return {
    ...receiptClaims,
    inside_verified_email: verifiedEmail,
  };
};
