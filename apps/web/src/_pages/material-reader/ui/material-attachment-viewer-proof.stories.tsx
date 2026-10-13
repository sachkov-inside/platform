import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
  MaterialAttachmentViewerProof,
  type AttachmentProofFile,
} from "@/features/material-assets/ui/material-attachment-viewer.prototype.client";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

// Synthetic Material-owned attachment set; no Product Artifact is used.
const files: readonly AttachmentProofFile[] = [
  {
    path: "AGENTS.md",
    downloadHref:
      "data:text/plain;charset=utf-8,%23%20Project%20instructions%0A%0ARead%20the%20task%20before%20changing%20code.%0AFind%20the%20module%20that%20owns%20the%20requested%20behavior.%0ARun%20the%20project%20checks%20after%20a%20change.%0A",
    text: "# Project instructions\n\nRead the task before changing code.\nFind the module that owns the requested behavior.\nRun the project checks after a change.\n",
  },
  {
    path: "skills/review.md",
    downloadHref:
      "data:text/plain;charset=utf-8,%23%20Review%20changes%0A%0A%23%23%20Scope%0A%0AReview%20the%20public%20behavior%20requested%20by%20the%20task.%0A%0A%23%23%20Checklist%0A%0A-%20Read%20the%20project%20standards.%0A-%20Check%20access%20and%20validation%20boundaries.%0A-%20Verify%20the%20behavior%20through%20the%20existing%20checks.%0A",
    text: "# Review changes\n\n## Scope\n\nReview the public behavior requested by the task.\n\n## Checklist\n\n- Read the project standards.\n- Check access and validation boundaries.\n- Verify the behavior through the existing checks.\n",
  },
  {
    path: "config/settings.json",
    downloadHref:
      "data:text/plain;charset=utf-8,%7B%0A%20%20%22language%22%3A%20%22ru%22%2C%0A%20%20%22reviewBeforeMerge%22%3A%20true%2C%0A%20%20%22workingDirectory%22%3A%20%22.%22%0A%7D%0A",
    text: '{\n  "language": "ru",\n  "reviewBeforeMerge": true,\n  "workingDirectory": "."\n}\n',
  },
  {
    path: "diagram.drawio",
    downloadHref:
      "data:text/plain;charset=utf-8,%3Cmxfile%3E%3Cdiagram%20name%3D%22Example%22%3E%3CmxGraphModel%3E%3Croot%3E%3CmxCell%20id%3D%220%22%2F%3E%3CmxCell%20id%3D%221%22%20parent%3D%220%22%2F%3E%3C%2Froot%3E%3C%2FmxGraphModel%3E%3C%2Fdiagram%3E%3C%2Fmxfile%3E",
  },
];
const bundleHref =
  "data:application/zip;base64,UEsDBBQAAAAIADNUTV3RGz+NbwAAAJUAAAAJAAAAQUdFTlRTLm1kLY1BEsJACATv+wqqvOcZnq38AFkS1igosPp9t5JcZ3p6LnBzezAlNI30TtlMo5SZsUIKQ2JscOfFnIEEdW26AlnlqVybHszLan8OVDDBfhp76PzpHMl1rAW/zXwqc9e9e5+fJExbAC7JDnj4h/gPUEsDBBQAAAAIADNUTV0bmm61kwAAANgAAAAQAAAAc2tpbGxzL3Jldmlldy5tZD2PwQ7CMAxD7/2KSDuzn+APQOKetmYNm9rRZAP+nlIQV/vZTgY6YRc8KCTOE9S5YaBzKCuc+zmWQOvmFwnkkXiXUqnivkENkfyrA8Y6jz18TAjzImrOHVo5x29BLTcEIzXOkWvUsbkdJQ4BqtR02nmRyCYlky/bBxR08oIq1+/S/wZLtWxT6iKebVDy1N5olS3yBlBLAwQUAAAACAAzVE1dgTND90YAAABPAAAAFAAAAGNvbmZpZy9zZXR0aW5ncy5qc29uq+ZSUFDKScxLL01MT1WyUlAqKlXSAYkVpZZlppY7pablF6X6phaBJUuKSlPBkuX5RdmZeekumUWpySX5RZUgjXpKXLVcAFBLAwQUAAAACAAzVE1dHKprfVwAAACIAAAADgAAAGRpYWdyYW0uZHJhd2lvVY0xDoAgEAS/Qu4DaA80xlj5iEs4leQOCKHg+Uakodyd7I6RdgUmZ3zAu6CoiEIW9oaSmcAZaUfB/JzJEztTUqpftxGzCt7CAnrKK6iMhWIdSP8LPd/oYeug+19QSwECFAMUAAAACAAzVE1d0Rs/jW8AAACVAAAACQAAAAAAAAAAAAAAgAEAAAAAQUdFTlRTLm1kUEsBAhQDFAAAAAgAM1RNXRuabrWTAAAA2AAAABAAAAAAAAAAAAAAAIABlgAAAHNraWxscy9yZXZpZXcubWRQSwECFAMUAAAACAAzVE1dgTND90YAAABPAAAAFAAAAAAAAAAAAAAAgAFXAQAAY29uZmlnL3NldHRpbmdzLmpzb25QSwECFAMUAAAACAAzVE1dHKprfVwAAACIAAAADgAAAAAAAAAAAAAAgAHPAQAAZGlhZ3JhbS5kcmF3aW9QSwUGAAAAAAQABADzAAAAVwIAAAAA";

const meta = {
  ...publicPageEnvironment("/materials/example-project-instructions", {
    account: "guest",
  }),
  title: "Prototypes/Materials/Attachment viewer",
  component: MaterialAttachmentViewerProof,
  args: { files, bundleHref },
  render: (args) => (
    <article className="mx-auto w-full max-w-[43rem] pb-16 pt-6">
      <CatalogBackLink
        href={productProgrammeHref("inside-ai-engineering")}
        label="К программе курса"
      />
      <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        Инструкции для рабочего проекта
      </h1>
      <p className="mt-6 text-base leading-8">
        В этом примере собраны правила проекта, инструкция проверки изменений и
        настройки. Они приложены к материалу отдельными файлами.
      </p>
      <p className="mt-5 text-base leading-8">
        Открой <MaterialAttachmentViewerProof {...args} />, прочитай инструкции
        и скопируй то, что подходит твоему проекту. Скачивать файлы для
        просмотра не нужно.
      </p>
      <h2 className="mt-10 text-xl font-semibold">Выбери нужное</h2>
      <p className="mt-4 text-base leading-8">
        Начни с AGENTS.md. Затем посмотри инструкцию проверки и пример настроек.
        Скопируй отдельный фрагмент или содержимое файла целиком.
      </p>
      <p className="mt-5 text-base leading-8">
        Если нужны все файлы, скачай комплект ZIP. После закрытия просмотра
        продолжи читать материал с этого места.
      </p>
    </article>
  ),
  parameters: {
    docs: {
      description: {
        component:
          "Новый объём #1378: просмотр файлов, приложенных непосредственно к материалу. Отдельный каталог артефактов не используется. Синтетический прототип; production и доступ к хранилищу не подключены.",
      },
    },
  },
} satisfies Meta<typeof MaterialAttachmentViewerProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InMaterial: Story = {};
export const Viewer: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "файлы к этому материалу",
      }),
    );
  },
};
export const Mobile: Story = {
  ...Viewer,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const SingleFile: Story = {
  ...Viewer,
  args: { files: files.slice(0, 1) },
};
export const Empty: Story = { ...Viewer, args: { files: [] } };
