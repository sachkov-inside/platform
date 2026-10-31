/** Explicit operation barrier, resolved only by the owning test step. */
export function deferred<Value = void>(): {
  promise: Promise<Value>;
  resolve: (value: Value | PromiseLike<Value>) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
