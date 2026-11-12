import { z } from "zod";

// Store on the site's origin: provider iframe storage can be partitioned or blocked.
const storageKey = "inside.video-preferences.v1";
const preferencesSchema = z.object({
  version: z.literal(1),
  volume: z.number().min(0).max(1).optional(),
  muted: z.boolean().optional(),
  playbackRate: z.number().positive().max(3).optional(),
});

type PlaybackPreferences = z.infer<typeof preferencesSchema>;

export function readPlaybackPreferences(): PlaybackPreferences {
  try {
    return preferencesSchema.parse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
    );
  } catch {
    return { version: 1 };
  }
}

export function savePlaybackPreferences(
  change: Omit<Partial<PlaybackPreferences>, "version">,
): void {
  const parsed = preferencesSchema.safeParse({
    ...readPlaybackPreferences(),
    ...change,
  });
  if (!parsed.success) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(parsed.data));
  } catch {
    // Playback remains available when browser storage is blocked or full.
  }
}
