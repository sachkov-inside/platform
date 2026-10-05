import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { authoringPageEnvironment } from "@/storybook/story-environment";

import { SurveyRespondentsView } from "./survey-respondents-view.client";

const environment = authoringPageEnvironment("/authoring/billing");
const templateId = "00000000-0000-4000-8000-000000000901";
/** Только выдуманные ники: настоящий список живёт в production БД. */
const data = {
  total: 3,
  issued: 2,
  purchased: 1,
  respondents: [
    {
      username: "synthetic_alpha",
      issuedAt: "2030-03-31T10:00:00.000Z",
      purchased: true,
    },
    {
      username: "synthetic_beta",
      issuedAt: "2030-04-01T09:00:00.000Z",
      purchased: false,
    },
    { username: "synthetic_gamma", issuedAt: null, purchased: false },
  ],
};
const link = {
  promotionId: "00000000-0000-4000-8000-000000000902",
  code: "Syn7hetic-Code",
  guideSlug: "synthetic-course",
  alreadyIssued: false,
};

const meta = {
  ...environment,
  title: "Pages/Authoring/Survey respondents",
  component: SurveyRespondentsView,
  args: {
    data,
    loading: false,
    busy: false,
    error: null,
    message: "",
    imported: null,
    link: null,
    origin: "https://inside.example.test",
    onRefresh: fn(),
    onImport: fn(),
    onIssue: fn(),
    onCopy: fn(),
  },
} satisfies Meta<typeof SurveyRespondentsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Владелец видит итог и выдаёт ссылку по нику из сообщения и архивному шаблону. */
export const Summary: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Купили по ссылке")).toBeVisible();
    await userEvent.type(
      canvas.getByLabelText("Telegram-ник"),
      "https://t.me/Synthetic_Gamma",
    );
    await userEvent.type(canvas.getByLabelText("Шаблон скидки"), templateId);
    await userEvent.click(
      canvas.getByRole("button", { name: "Выдать ссылку" }),
    );
    await expect(args.onIssue).toHaveBeenCalledWith({
      username: "https://t.me/Synthetic_Gamma",
      templatePromotionId: templateId,
    });
  },
};

/** Готовая ссылка ведёт на страницу оплаты продукта с кодом и копируется одной кнопкой. */
export const LinkIssued: Story = {
  args: { link },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const url =
      "https://inside.example.test/products/synthetic-course/buy?promo=Syn7hetic-Code";
    await expect(canvas.getByText(url)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Скопировать" }));
    await expect(args.onCopy).toHaveBeenCalledWith(url);
  },
};

export const LinkAlreadyIssued: Story = {
  args: { link: { ...link, alreadyIssued: true } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/ссылка уже выдана/u),
    ).toBeVisible();
  },
};

/** Итог загрузки называет только числа: нераспознанные строки не показываются. */
export const Imported: Story = {
  args: {
    imported: { recognized: 131, added: 131, unrecognized: 4, total: 131 },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Загрузить колонку анкеты"));
    await expect(canvas.getByText(/не распознано 4/u)).toBeVisible();
    await userEvent.type(
      canvas.getByLabelText("Колонка с Telegram"),
      "@synthetic_delta",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Загрузить" }));
    await expect(args.onImport).toHaveBeenCalledWith("@synthetic_delta");
  },
};

export const Mobile: Story = {
  args: { link },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { link },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
