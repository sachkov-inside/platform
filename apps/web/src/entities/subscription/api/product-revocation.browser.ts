import {
  previewProductRevocationOperation,
  revokeProductAccessOperation,
} from "./product-revocation.operation";
export const previewProductRevocation = previewProductRevocationOperation.send;
export const revokeProductAccess = revokeProductAccessOperation.send;
