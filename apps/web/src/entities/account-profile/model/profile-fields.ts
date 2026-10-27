export function accountProfileTextLength(value: string): number {
  return Array.from(value).length;
}

export function displayNameLengthIsValid(value: string): boolean {
  const length = accountProfileTextLength(value.trim());
  return length >= 2 && length <= 80;
}

export function bioLengthIsValid(value: string): boolean {
  return accountProfileTextLength(value) <= 500;
}
