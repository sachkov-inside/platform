// @ts-check
// One-time owner sign-in for a trusted authoring target (#805):
//   pnpm authoring:login --target production --client-id CLIENT_ID [--scope SCOPE]
//   pnpm authoring:login --target production --logout
import { parseArgs } from "node:util";
import { keychainStore, login, logout, ownerSession } from "./credentials.mjs";
import { trustedTarget } from "./target.mjs";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "production" },
    "client-id": { type: "string" },
    scope: { type: "string" },
    logout: { type: "boolean", default: false },
  },
});
const target = trustedTarget(values.target);
const store = keychainStore();
if (values.logout) {
  await logout(target, store);
  process.stdout.write(`Сессия ${target.name} удалена из Keychain.\n`);
} else {
  const clientId = values["client-id"];
  if (clientId === undefined)
    throw new Error(
      "Usage: pnpm authoring:login --target production --client-id CLIENT_ID [--scope SCOPE] | --logout",
    );
  process.stdout.write("Открываю вход в браузере…\n");
  await login(target, { clientId, scope: values.scope, store });
  // The first renewal proves the stored session before an agent relies on it.
  await ownerSession(target, { store })();
  process.stdout.write(
    `Вход выполнен. Сессия ${target.name} сохранена в Keychain; следующие переносы входа не требуют.\n`,
  );
}
