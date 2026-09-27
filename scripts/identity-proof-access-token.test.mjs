// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  accessTokenExpiredAt,
  readAccessTokenTtl,
} from "./identity-proof-access-token.mjs";

const signedInAt = Date.UTC(2026, 8, 27, 12, 0, 0);

test("без настройки стенд и проверки берут наибольший срок, пять минут", () => {
  assert.equal(readAccessTokenTtl({}), 300);
  assert.equal(accessTokenExpiredAt(signedInAt, {}), signedInAt + 301_000);
});

test("срок стенда hardening, 60 секунд, даёт ту же паузу, что прежние 61 секунда", () => {
  const environment = { IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS: "60" };
  assert.equal(readAccessTokenTtl(environment), 60);
  assert.equal(
    accessTokenExpiredAt(signedInAt, environment),
    signedInAt + 61_000,
  );
});

test("срок вне 60–300 секунд или не целое число отклоняется", () => {
  for (const value of ["59", "301", "90.5", "минута", ""]) {
    assert.throws(
      () =>
        readAccessTokenTtl({ IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS: value }),
      /between 60 and 300/u,
      value,
    );
  }
});
