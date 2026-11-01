import { vi } from "vitest";

/** Строки журнала уровня warn, записанные за время работы; каждая строка разобрана как JSON. */
export async function warnings<Value>(
  work: () => Promise<Value>,
): Promise<{ readonly result: Value; readonly lines: unknown[] }> {
  const lines: unknown[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)));
  });
  try {
    return { result: await work(), lines };
  } finally {
    warn.mockRestore();
  }
}
