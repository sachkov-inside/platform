import { materialAnnouncementsResponseSchema } from "@inside/contracts/material-announcements";
import type { MaterialAnnouncementSource } from "../../modules/communications/material-announcement-source.js";
import { readBoundedJson } from "./read-bounded-json.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
export class HttpMaterialAnnouncementsAdapter implements MaterialAnnouncementSource {
  private readonly endpoint: string;
  constructor(
    authorizationEndpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = new URL("materials", authorizationEndpoint).href;
  }
  async read(query: { after?: string; announcementRef?: string }) {
    const signal = AbortSignal.timeout(5000);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contractVersion: "inside.material-announcements.v1",
          ...query,
        }),
      });
      if (!response.ok) return null;
      const parsed = materialAnnouncementsResponseSchema.safeParse(
        await readBoundedJson(response, 200_000, signal),
      );
      return parsed.success ? parsed.data : null;
    } catch (error) {
      reportFailure("platform.material-announcements", error);
      return null;
    }
  }
}
