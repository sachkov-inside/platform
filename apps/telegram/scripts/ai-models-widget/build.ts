import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildWidgetHtml, writeWidgetModule } from "../widget-build.js";

// Builds the ИИ-модели widget into the module the bot sends (scripts/widget-build.ts).
const widgetDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/modules/ai-models/widget",
);

export function buildAiModelsWidgetHtml(): Promise<string> {
  return buildWidgetHtml(widgetDirectory);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await writeWidgetModule({
    name: "ИИ-модели widget",
    directory: widgetDirectory,
    generatedFile: path.join(
      widgetDirectory,
      "ai-models-widget-html.generated.ts",
    ),
    exportName: "AI_MODELS_WIDGET_HTML",
    command: "ai-models:widget:build",
  });
