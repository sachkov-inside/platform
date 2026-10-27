import { z } from "zod";
import {
  ACTIVATION_CONTRACT_VERSION,
  activationCodeSchema,
} from "./course-activation.js";

export const announcementQuerySchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
  code: activationCodeSchema,
});
