export interface ContinueMaterialView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly format: string;
  readonly resume:
    | { readonly kind: "start" }
    | { readonly kind: "position"; readonly positionSeconds: number }
    | { readonly kind: "reached-end" };
}

export type PersonalHomeView =
  | { readonly kind: "hidden" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly items: readonly ContinueMaterialView[] };
