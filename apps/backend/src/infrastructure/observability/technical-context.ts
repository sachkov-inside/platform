import { context, createContextKey, ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

const ownershipKey = createContextKey("inside.technical.context.owner");
let owned:
  | { readonly manager: AsyncLocalStorageContextManager; leases: number }
  | undefined;

function isRegistered(manager: AsyncLocalStorageContextManager): boolean {
  // Compare through public APIs; never inspect or unregister a foreign global manager.
  return manager.with(
    ROOT_CONTEXT.setValue(ownershipKey, manager),
    () => context.active().getValue(ownershipKey) === manager,
  );
}

/** Enabled runtimes share one process context manager; the last lease releases only our manager. */
export function acquireTechnicalContext(): { release(): void } | undefined {
  if (owned !== undefined && !isRegistered(owned.manager)) return undefined;
  if (owned === undefined) {
    const manager = new AsyncLocalStorageContextManager().enable();
    if (!context.setGlobalContextManager(manager)) {
      manager.disable();
      return undefined;
    }
    owned = { manager, leases: 0 };
  }
  const leaseOwner = owned;
  leaseOwner.leases++;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      leaseOwner.leases--;
      if (leaseOwner.leases === 0) {
        if (isRegistered(leaseOwner.manager)) context.disable();
        else leaseOwner.manager.disable();
        if (owned === leaseOwner) owned = undefined;
      }
    },
  };
}
