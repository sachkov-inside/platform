import {
  Activity,
  Suspense,
  startTransition,
  use,
  useLayoutEffect,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, waitFor, within } from "storybook/test";
import {
  MaterialReadingScope,
  useMaterialReading,
  type MaterialReadingValue,
} from "./reading-context.client";

export default { title: "Patterns/Reader/Reading scope" };
const initial: MaterialReadingValue = {
  accountId: null,
  resolved: false,
  failed: false,
  states: new Map(),
  register: () => () => undefined,
  refresh: () => Promise.resolve(),
};
function Reader({ label, id }: { label: string; id?: string | undefined }) {
  const reading = useMaterialReading(id);
  return (
    <output aria-label={label}>
      {reading.resolved ? reading.accountId : "pending"}
    </output>
  );
}
function Late({ gate }: { gate: Promise<void> | null }) {
  if (gate !== null) use(gate);
  return <Reader label="Late" />;
}
function Shell({
  children,
  onCommit,
}: {
  children: React.ReactNode;
  onCommit: () => void;
}) {
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    if (value.resolved) queueMicrotask(onCommit);
  }, [onCommit, value]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          startTransition(() => {
            setValue({ ...initial, resolved: true, accountId: "reader" });
          });
        }}
      >
        Resolve account
      </button>
      <MaterialReadingScope value={value}>{children}</MaterialReadingScope>
    </>
  );
}
function tree(gate: Promise<void> | null, onCommit: () => void) {
  return (
    <Shell onCommit={onCommit}>
      <Reader label="Early" />
      <Suspense fallback="loading">
        <Late gate={gate} />
      </Suspense>
    </Shell>
  );
}
export const DelayedHydration = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = document.createElement("div");
    canvasElement.append(host);
    const gate = Promise.withResolvers<undefined>();
    const committed = Promise.withResolvers<string | null>();
    const onCommit = () => {
      committed.resolve(within(host).getByLabelText("Early").textContent);
    };
    host.innerHTML = renderToString(tree(null, onCommit));
    const canvas = within(host);
    const late = canvas.getByLabelText("Late");
    const errors: unknown[] = [];
    const root = hydrateRoot(host, tree(gate.promise, onCommit), {
      onRecoverableError(error) {
        errors.push(error);
      },
    });
    try {
      await expect(late).toHaveTextContent("pending");
      canvas.getByRole("button", { name: "Resolve account" }).click();
      await expect(await committed.promise).toBe("reader");
      await expect(late).toHaveTextContent("pending");
      gate.resolve(undefined);
      await waitFor(() =>
        expect(canvas.getByLabelText("Late")).toHaveTextContent("reader"),
      );
      await expect(canvas.getByLabelText("Late")).toBe(late);
      await expect(errors).toEqual([]);
    } finally {
      gate.resolve(undefined);
      root.unmount();
      host.remove();
    }
  },
};
function demand() {
  const ids = new Map<string, number>();
  const register = (id: string) => {
    ids.set(id, (ids.get(id) ?? 0) + 1);
    return () => {
      const count = ids.get(id);
      if (count === 1) ids.delete(id);
      else if (count !== undefined) ids.set(id, count - 1);
    };
  };
  return { ids, register };
}
export const RegistrationOwner = {
  render: () => <div />,
  play: async () => {
    const root = createRoot(document.createElement("div"));
    const first = demand(),
      second = demand();
    function show(
      owner: ReturnType<typeof demand>,
      id: string | undefined,
      mode: "hidden" | "visible" = "visible",
    ) {
      flushSync(() => {
        root.render(
          <MaterialReadingScope
            value={{ ...initial, register: owner.register }}
          >
            <Reader label="Permanent" id="a" />
            <Activity mode={mode}>
              <Reader label="Changing" id={id} />
            </Activity>
          </MaterialReadingScope>,
        );
      });
    }
    try {
      show(first, "a");
      await expect([...first.ids]).toEqual([["a", 2]]);
      show(second, "b");
      await expect([...first.ids]).toEqual([]);
      await expect([...second.ids].sort()).toEqual([
        ["a", 1],
        ["b", 1],
      ]);
      show(second, "b", "hidden");
      await expect([...second.ids]).toEqual([["a", 1]]);
      show(second, "b");
      await expect(second.ids.get("b")).toBe(1);
      show(second, undefined);
      await expect([...second.ids]).toEqual([["a", 1]]);
      flushSync(() => {
        root.render(null);
      });
      await expect([...second.ids]).toEqual([]);
    } finally {
      root.unmount();
    }
  },
};
