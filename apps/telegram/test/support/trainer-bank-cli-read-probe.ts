/** Observe real pipe reads without changing bytes or replacing the input source. */
const read = process.stdin.read.bind(process.stdin);
process.stdin.read = (size?: number): unknown => {
  const chunk: unknown = read(size);
  if (Buffer.isBuffer(chunk)) process.send?.({ readBytes: chunk.byteLength });
  return chunk;
};
// The observation channel must not keep a completed CLI alive.
process.channel?.unref();
