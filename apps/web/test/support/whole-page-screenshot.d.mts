import type { Page, PageScreenshotOptions } from "@playwright/test";

export declare function screenshotWholePage(
  page: Page,
  options?: Omit<PageScreenshotOptions, "fullPage">,
): Promise<Buffer>;
