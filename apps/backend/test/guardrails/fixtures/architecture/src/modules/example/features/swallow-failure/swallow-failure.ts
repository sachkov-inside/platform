export async function swallowFailure(read: () => Promise<string>): Promise<string | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

export async function ignoreFailure(read: () => Promise<string>): Promise<string | undefined> {
  try {
    return await read();
  } catch (error) {
    return undefined;
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

export async function swallowRejection(read: () => Promise<string>): Promise<string | null> {
  return read().catch(() => null);
}
