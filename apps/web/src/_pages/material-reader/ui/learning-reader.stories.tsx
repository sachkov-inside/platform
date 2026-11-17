import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  learningArtifacts,
  learningReferenceReader,
} from "@/storybook/learning.fixtures";
import {
  InlineArtifactDownload,
  readInlineArtifactReference,
} from "@/features/product-artifacts.reader";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialReaderView } from "./material-reader-view";

const environment = publicPageEnvironment("/materials/synthetic-reference");
const meta = {
  ...environment,
  title: "Pages/Material/Synthetic learning reference",
  component: MaterialReaderView,
  args: {
    ...learningReferenceReader(),
    primaryVideo: null,
    renderLink: (href, label) => {
      const reference = readInlineArtifactReference(href);
      return reference === undefined ? undefined : (
        <InlineArtifactDownload
          href={href}
          label={label}
          artifact={
            learningArtifacts.kind === "ready"
              ? learningArtifacts.artifacts.find(
                  (artifact) => artifact.sourceId === reference.sourceId,
                )
              : undefined
          }
        />
      );
    },
  },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FileAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", {
        name: "Учебный пример: памятка",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Скачать шаблон результата (.txt)" }),
    ).toHaveAttribute("download");
    await expect(
      canvas.getByRole("link", { name: "Скачать шаблон результата (.txt)" }),
    ).toHaveAttribute(
      "href",
      "/api/products/97000000-0000-4000-8000-000000000001/artifact-sources/synthetic-scenarios%3Aresult/file",
    );
    await expect(canvas.getByText(/synthetic-result.txt/)).toBeVisible();
  },
};
export const Mobile: Story = {
  ...FileAction,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
