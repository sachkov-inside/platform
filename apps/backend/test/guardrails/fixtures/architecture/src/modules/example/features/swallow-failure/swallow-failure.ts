export async function swallowFailure(read: () => Promise<string>): Promise<string | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

export async function dropFailure(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    return error instanceof Error ? "failed" : "unknown";
  }
}

export function explainedRejection(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a dependency failure: malformed client input is answered as invalid.
    return undefined;
  }
}

export function lateExplanation(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fallback = undefined;
    // Not a dependency failure: a marker below the first statement explains nothing.
    return fallback;
  }
}

export async function swallowRejection(read: () => Promise<string>): Promise<string | null> {
  return read().catch(() => null);
}

export async function replaceFailure(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    // reportDependencyFailure(scope, error) in a comment records nothing.
    throw new Error("replaced");
  }
}
