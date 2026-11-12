import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildWidgetHtml,
  widgetSize,
  writeWidgetModule,
  type WidgetSize,
} from "../widget-build.js";

// Builds the Trainer widget into the module the bot sends (scripts/widget-build.ts).
const widgetDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/modules/trainer/widget",
);

export type TrainerWidgetSize = WidgetSize;

export function buildTrainerWidgetHtml(): Promise<string> {
  return buildWidgetHtml(widgetDirectory);
}

export function trainerWidgetSize(html: string): TrainerWidgetSize {
  return widgetSize(html);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await writeWidgetModule({
    name: "Trainer widget",
    directory: widgetDirectory,
    generatedFile: path.join(
      widgetDirectory,
      "trainer-widget-html.generated.ts",
    ),
    exportName: "TRAINER_WIDGET_HTML",
    command: "trainer:widget:build",
  });
