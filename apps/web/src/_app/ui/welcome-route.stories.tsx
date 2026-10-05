import { currentLegalEdition } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { HomeBackdrop } from "@/_pages/home";
import { illustratedPinnedHome } from "@/storybook/home.fixtures";
import { WelcomeBackdrop } from "@/_pages/welcome";
import { WelcomeScreen, WelcomeView } from "@/features/terms-acceptance";
import {
  legalDocumentPath,
  legalEditionPath,
} from "@/shared/routing/public-page-path";
import {
  fetchBeforeRender,
  type MutationFetch,
} from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

/**
 * Маршрут `/welcome` целиком: окно поверх размытой главной, как в `app/(public)/welcome/page.tsx`.
 * Страница открывается только вошедшему человеку без принятия действующей редакции условий,
 * поэтому шапка показывает аккаунт. Гость и человек, принявший условия, страницу не видят:
 * `WelcomePage` уводит их дальше.
 */
const environment = publicPageEnvironment("/welcome", {
  account: "authenticated",
});

const terms = currentLegalEdition("terms");
/** Как `WelcomePage`: редакция, которую backend просит принять, и её постоянный адрес. */
const document = { version: String(terms.version), digest: terms.digest };
const termsHref = legalEditionPath("terms", terms.version);
const privacyHref = legalDocumentPath("privacy");

/** Ответ BFF `/api/account/terms`; без подмены кнопка ушла бы на настоящий адрес. */
function acceptResponse(status: number, body?: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }),
  );
}

const meta = {
  ...environment,
  decorators: [
    (Story) => (
      <>
        <WelcomeBackdrop>
          <HomeBackdrop
            result={{ kind: "ready", value: illustratedPinnedHome }}
          />
        </WelcomeBackdrop>
        <Story />
      </>
    ),
    ...environment.decorators,
  ],
  title: "Pages/Welcome",
  component: WelcomeScreen,
  tags: ["autodocs"],
  args: {
    document,
    onAccepted: fn(),
    privacyHref,
    returnTo: "/",
    returning: false,
    termsHref,
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Окно первого входа поверх сайта: условия использования принимаются одной кнопкой со строкой о принятии, без отметок. Окно не закрывается без решения; до нажатия закрыты кабинет, покупки и связка с ботом.",
      },
    },
  },
} satisfies Meta<typeof WelcomeScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstSignIn: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  beforeEach: fetchBeforeRender(() =>
    acceptResponse(200, { kind: "accepted" }),
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole("dialog", {
      name: "Добро пожаловать",
    });
    await expect(dialog).toHaveAttribute("open");
    await expect(
      canvas.getByRole("button", { name: "Принять условия и продолжить" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toHaveAttribute("open");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "условия использования" }),
    ).toHaveAttribute("href", termsHref);
    await expect(
      canvas.getByText(/пользоваться Inside можно с 14 лет/u),
    ).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Принять условия и продолжить" }),
    );
    await waitFor(() => expect(args.onAccepted).toHaveBeenCalledWith("/"));
  },
};

export const FirstSignInMobile: Story = {
  ...FirstSignIn,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

/** Человек принимал прежнюю редакцию: окно говорит, что условия обновились. */
export const UpdatedTerms: Story = {
  args: { returning: true },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("dialog", { name: "Условия обновились" }),
    ).toHaveAttribute("open");
  },
};

/** Ответ ещё не пришёл: кнопка занята, второе нажатие не пишет вторую операцию. */
export const Pending: Story = {
  beforeEach: fetchBeforeRender(() => new Promise<Response>(() => undefined)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Принять условия и продолжить",
      }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Принимаем…" }),
    ).toBeDisabled();
  },
};

function failedAcceptance(
  respond: MutationFetch,
  message: string,
): Pick<Story, "beforeEach" | "play"> {
  return {
    beforeEach: fetchBeforeRender(respond),
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(
        await canvas.findByRole("button", {
          name: "Принять условия и продолжить",
        }),
      );
      await expect(await canvas.findByText(message)).toBeVisible();
    },
  };
}

export const EditionChanged: Story = failedAcceptance(
  () => acceptResponse(200, { kind: "document_changed" }),
  "Условия только что обновились. Прочитайте действующую редакцию и нажмите кнопку снова.",
);

export const SessionEnded: Story = failedAcceptance(
  () => acceptResponse(401),
  "Сессия завершилась. Войдите снова.",
);

export const AcceptFailed: Story = failedAcceptance(
  () => acceptResponse(503),
  "Не получилось принять условия. Повторите — повторное нажатие безопасно.",
);

/** Проверить условия нельзя: `WelcomePage` показывает окно без кнопки принятия. */
export const Unavailable: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  render: () => (
    <WelcomeView
      privacyHref={privacyHref}
      returning={false}
      termsHref={legalDocumentPath("terms")}
      unavailable
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = within(
      await canvas.findByRole("dialog", { name: "Добро пожаловать" }),
    );
    await expect(card.getByRole("alert")).toHaveTextContent(
      "Условия сейчас не удаётся загрузить",
    );
    await expect(card.queryByRole("button")).not.toBeInTheDocument();
    await expect(
      card.getByRole("link", { name: "На главную" }),
    ).toHaveAttribute("href", "/");
  },
};
