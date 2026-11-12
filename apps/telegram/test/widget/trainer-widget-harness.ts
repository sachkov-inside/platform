import { buildTrainerWidgetHtml } from "../../scripts/trainer-widget/build.js";
import { widgetPage, type WidgetPageOptions } from "./widget-harness.js";

/** The built Trainer widget inside the stand-in Telegram app of widget-harness.ts. */
export function trainerWidgetPage(options: WidgetPageOptions): Promise<string> {
  return widgetPage(buildTrainerWidgetHtml(), options);
}
