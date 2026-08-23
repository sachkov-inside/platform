export function validationIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "";
  }
  return `/${path
    .map(String)
    .map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/")}`;
}
