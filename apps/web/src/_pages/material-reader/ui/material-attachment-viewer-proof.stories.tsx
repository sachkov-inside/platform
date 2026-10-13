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
    path: "skills/review/checklist.md",
    downloadHref:
      "data:text/plain;charset=utf-8,%23%20Review%20changes%0A%0A%23%23%20Scope%0A%0AReview%20the%20public%20behavior%20requested%20by%20the%20task.%0A%0A%23%23%20Checklist%0A%0A-%20Read%20the%20project%20standards.%0A-%20Check%20access%20and%20validation%20boundaries.%0A-%20Verify%20the%20behavior%20through%20the%20existing%20checks.%0A%0A%23%23%20Review%20step%201%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%202%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%203%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%204%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%205%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%206%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%207%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%208%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%209%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2010%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2011%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2012%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2013%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2014%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2015%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2016%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2017%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2018%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2019%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2020%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2021%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2022%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2023%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2024%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0A%23%23%20Review%20step%2025%0A%0ARead%20the%20changed%20module%20and%20its%20callers.%20Check%20the%20requested%20behavior%20and%20access%20boundary.%20Record%20concrete%20findings%20with%20the%20affected%20file%20path.%0A%0AEND%20OF%20REVIEW%20INSTRUCTIONS%0A",
    text: "# Review changes\n\n## Scope\n\nReview the public behavior requested by the task.\n\n## Checklist\n\n- Read the project standards.\n- Check access and validation boundaries.\n- Verify the behavior through the existing checks.\n\n## Review step 1\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 2\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 3\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 4\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 5\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 6\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 7\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 8\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 9\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 10\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 11\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 12\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 13\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 14\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 15\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 16\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 17\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 18\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 19\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 20\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 21\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 22\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 23\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 24\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\n## Review step 25\n\nRead the changed module and its callers. Check the requested behavior and access boundary. Record concrete findings with the affected file path.\n\nEND OF REVIEW INSTRUCTIONS\n",
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
  "data:application/zip;base64,UEsDBBQAAAAIAAAATV3RGz+NbwAAAJUAAAAJAAAAQUdFTlRTLm1kLY1BEsJACATv+wqqvOcZnq38AFkS1igosPp9t5JcZ3p6LnBzezAlNI30TtlMo5SZsUIKQ2JscOfFnIEEdW26AlnlqVybHszLan8OVDDBfhp76PzpHMl1rAW/zXwqc9e9e5+fJExbAC7JDnj4h/gPUEsDBBQAAAAIAAAATV0KoGsnVAEAAAgRAAAaAAAAc2tpbGxzL3Jldmlldy9jaGVja2xpc3QubWTVlctOwzAQRff+ipG6JsLmvS5F6qaV2gJrx57UQ0McbKelf4/zACHxA8zWcz33zOrMYINHwhMYp5s9RiFmM9ga36IQ0yQ5hLYrazJQotNH8gECfnQYE1ooz0Mg6Xgohs9zh+ZQU0xCXOTl2o4Lgn9DkyAm3VgdbCzydIiCNgZjhPwOR12T1Yl8A6Xv+iDhkHzBQNXY9MOQXPDd3g2P+JkLqdnnM/LKOJJM/BmzBdmfM7GMp1p497arcSimFMHousYQiwmrT/4687u1T0/EE+K5yE3GBwvGNyZgQqiosZkmwonSCKirKp+fF1WUK1ud3F9GxYDxigHjNQPGGwaMtwwY7xgw3jNgfGDAKC85QHIwjeSgGsnBNZKDbCQH20gOupEcfCM5CEdyMI7iYBzFwTiKg3EUB+MoDsZR/9I4i9UjrJ9gs3hZLl5hudruNs/z3XK92oovUEsDBBQAAAAIAAAATV2BM0P3RgAAAE8AAAAUAAAAY29uZmlnL3NldHRpbmdzLmpzb26r5lJQUMpJzEsvTUxPVbJSUCoqVdIBiRWllmWmljulpuUXpfqmFoElS4pKU8GS5flF2Zl56S6ZRanJJflFlSCNekpctVwAUEsDBBQAAAAIAAAATV0cqmt9XAAAAIgAAAAOAAAAZGlhZ3JhbS5kcmF3aW9VjTEOgCAQBL9C7gNoDzTGWPmISziV5A4IoeD5RqSh3J3sjpF2BSZnfMC7oKiIQhb2hpKZwBlpR8H8nMkTO1NSql+3EbMK3sICesorqIyFYh1I/ws93+hh66D7X1BLAQIUAxQAAAAIAAAATV3RGz+NbwAAAJUAAAAJAAAAAAAAAAAAAACAAQAAAABBR0VOVFMubWRQSwECFAMUAAAACAAAAE1dCqBrJ1QBAAAIEQAAGgAAAAAAAAAAAAAAgAGWAAAAc2tpbGxzL3Jldmlldy9jaGVja2xpc3QubWRQSwECFAMUAAAACAAAAE1dgTND90YAAABPAAAAFAAAAAAAAAAAAAAAgAEiAgAAY29uZmlnL3NldHRpbmdzLmpzb25QSwECFAMUAAAACAAAAE1dHKprfVwAAACIAAAADgAAAAAAAAAAAAAAgAGaAgAAZGlhZ3JhbS5kcmF3aW9QSwUGAAAAAAQABAD9AAAAIgMAAAAA";

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
