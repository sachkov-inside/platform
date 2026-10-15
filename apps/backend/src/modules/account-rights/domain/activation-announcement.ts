import { z } from "zod";
import {
  ACTIVATION_CONTRACT_VERSION,
  activationCodeSchema,
} from "./subscription-activation.js";

export const announcementQuerySchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
  code: activationCodeSchema,
});
