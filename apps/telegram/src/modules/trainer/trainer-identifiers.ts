import { z } from "zod";

/** A compact topic code or base-36 issue identifier accepted by the widget protocol. */
export const TRAINER_CODE_PATTERN = "[0-9a-z]{1,16}";
export const trainerCodeFormat = new RegExp(`^${TRAINER_CODE_PATTERN}$`);
export const trainerCodeSchema = z.string().regex(trainerCodeFormat);
