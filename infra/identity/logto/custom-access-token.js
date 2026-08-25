// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getCustomJwtClaims = async ({ token, context, api }) => {
  if (token.gty !== 'authorization_code') {
    return {};
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
    return api.denyAccess('A fresh verified email interaction is required');
  }

  return {
    inside_verified_email: verifiedEmail,
    inside_interactive_at: new Date().toISOString(),
  };
};
