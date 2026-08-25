import {
  InteractionEvent,
  type VerificationCodeIdentifier,
} from '@logto/schemas';
import { useCallback, useMemo } from 'react';

import { identifyWithVerificationCode, registerWithVerifiedIdentifier } from '@/apis/experience';
import useApi from '@/hooks/use-api';
import type { ErrorHandlers } from '@/hooks/use-error-handler';
import useErrorHandler from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { useSieMethods } from '@/hooks/use-sie';
import useSubmitInteractionErrorHandler from '@/hooks/use-submit-interaction-error-handler';
import useTerms from '@/hooks/use-terms';

import useGeneralVerificationCodeErrorHandler from './use-general-verification-code-error-handler';
import useIdentifierErrorAlert, { IdentifierErrorType } from './use-identifier-error-alert';

const useSignInFlowCodeVerification = (
  identifier: VerificationCodeIdentifier,
  verificationId: string,
  errorCallback?: () => void
) => {
  const { termsValidation } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();
  const redirectTo = useGlobalRedirectTo();
  const { isVerificationCodeEnabledForSignUp } = useSieMethods();
  const handleError = useErrorHandler();
  const registerWithIdentifierAsync = useApi(registerWithVerifiedIdentifier);
  const asyncSignInWithVerificationCodeIdentifier = useApi(identifyWithVerificationCode);

  const { errorMessage, clearErrorMessage, generalVerificationCodeErrorHandlers } =
    useGeneralVerificationCodeErrorHandler();

  const preSignInErrorHandler = useSubmitInteractionErrorHandler(InteractionEvent.SignIn, {
    replace: true,
  });
  const preRegisterErrorHandler = useSubmitInteractionErrorHandler(InteractionEvent.Register, {
    replace: true,
  });

  const showIdentifierErrorAlert = useIdentifierErrorAlert();

  const identifierNotExistErrorHandler = useCallback(async () => {
    const { type, value } = identifier;

    if (!isVerificationCodeEnabledForSignUp(type)) {
      void showIdentifierErrorAlert(IdentifierErrorType.IdentifierNotExist, type, value);

      return;
    }

    // Inside uses one email-code entry point for both returning and new users. Once Logto has
    // verified an unknown address, continue registration directly instead of interrupting the
    // user with the provider's redundant "create account?" confirmation.
    if (!(await termsValidation())) {
      navigate(-1);
      return;
    }

    const [error, result] = await registerWithIdentifierAsync(verificationId);

    if (error) {
      await handleError(error, preRegisterErrorHandler);

      return;
    }

    if (result?.redirectTo) {
      await redirectTo(result.redirectTo);
    }
  }, [
    identifier,
    isVerificationCodeEnabledForSignUp,
    termsValidation,
    showIdentifierErrorAlert,
    registerWithIdentifierAsync,
    verificationId,
    handleError,
    preRegisterErrorHandler,
    redirectTo,
    navigate,
  ]);

  const errorHandlers = useMemo<ErrorHandlers>(
    () => ({
      'user.user_not_exist': identifierNotExistErrorHandler,
      ...generalVerificationCodeErrorHandlers,
      ...preSignInErrorHandler,
      callback: errorCallback,
    }),
    [
      errorCallback,
      identifierNotExistErrorHandler,
      preSignInErrorHandler,
      generalVerificationCodeErrorHandlers,
    ]
  );

  const onSubmit = useCallback(
    async (code: string) => {
      const [error, result] = await asyncSignInWithVerificationCodeIdentifier({
        verificationId,
        identifier,
        code,
      });

      if (error) {
        await handleError(error, errorHandlers);
        return;
      }

      if (result?.redirectTo) {
        await redirectTo(result.redirectTo);
      }
    },
    [
      asyncSignInWithVerificationCodeIdentifier,
      errorHandlers,
      handleError,
      identifier,
      redirectTo,
      verificationId,
    ]
  );

  return {
    errorMessage,
    clearErrorMessage,
    onSubmit,
  };
};

export default useSignInFlowCodeVerification;
