export function memberProfileTextLength(value: string): number {
  return Array.from(value).length;
}

export function displayNameLengthIsValid(value: string): boolean {
  const length = memberProfileTextLength(value.trim());
  return length >= 2 && length <= 80;
}

export function bioLengthIsValid(value: string): boolean {
  return memberProfileTextLength(value) <= 500;
}
