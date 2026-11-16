export const scenarioRoles: {
  readonly owner: { readonly subject: string; readonly name: string };
  readonly holder: {
    readonly subject: string;
    readonly name: string;
    readonly productId: string;
  };
  readonly learner: { readonly subject: string; readonly name: string };
  readonly newcomer: { readonly subject: string; readonly name: null };
};
