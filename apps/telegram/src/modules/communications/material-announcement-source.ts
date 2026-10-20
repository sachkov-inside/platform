import type { MaterialAnnouncement } from "@inside/contracts/material-announcements";
export const MATERIAL_ANNOUNCEMENT_SOURCE = Symbol(
  "MATERIAL_ANNOUNCEMENT_SOURCE",
);
export interface MaterialAnnouncementSource {
  read(query: { after?: string; announcementRef?: string }): Promise<{
    items: MaterialAnnouncement[];
    nextCursor: string | null;
  } | null>;
}
export class DisabledMaterialAnnouncementSource implements MaterialAnnouncementSource {
  read(): Promise<null> {
    return Promise.resolve(null);
  }
}
