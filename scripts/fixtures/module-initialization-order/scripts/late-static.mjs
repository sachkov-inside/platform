// @ts-check
// A static field runs its initializer when the class is declared.
class Limits {
  static request = readLimit();
}
process.stdout.write(`${Limits.request}\n`);

const limit = 1;

function readLimit() {
  return limit;
}
