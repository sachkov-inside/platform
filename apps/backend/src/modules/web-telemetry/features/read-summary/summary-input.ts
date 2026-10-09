import { z } from "zod";

export const summaryDaysSchema = z.number().int().min(1).max(30);
