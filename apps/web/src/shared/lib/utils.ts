import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `text-lesson` is the lesson's reading size from globals.css. Registered as a font size, it
 * replaces `text-sm` and the like, and never removes a text colour.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["lesson"] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
