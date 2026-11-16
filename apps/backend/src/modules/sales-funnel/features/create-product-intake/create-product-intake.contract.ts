export interface CreateProductIntakeCommand {
  readonly intakeId: string;
  readonly productId: string;
  readonly name: string;
  readonly accepting: boolean;
}
export interface ProductIntakeReceipt {
  readonly intakeId: string;
  readonly productId: string;
  readonly name: string;
  readonly accepting: boolean;
}
export type CreateProductIntakeResult =
  | { readonly ok: true; readonly value: ProductIntakeReceipt }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "invalid_request"
          | "product_not_found"
          | "intake_conflict"
          | "accepting_intake_exists"
          | "dependency_unavailable";
      };
    };
export type CreateProductIntakeOperation = (
  input: unknown,
) => Promise<CreateProductIntakeResult>;
