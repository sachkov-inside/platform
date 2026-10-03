export declare function browserTestPorts<const Names extends readonly string[]>(
  names: Names,
): { [Index in keyof Names]: string };
