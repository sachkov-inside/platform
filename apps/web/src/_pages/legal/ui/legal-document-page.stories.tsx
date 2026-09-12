import { currentLegalEdition, parseLegalText } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { publicPageEnvironment } from "@/workshop/story-environment";

import { LegalDocumentPage } from "./legal-document-page";

const environment = publicPageEnvironment("/legal/terms");
const terms = currentLegalEdition("terms");
const blocks = parseLegalText(terms.text);
/** Прежней редакции в комплекте пока нет; story показывает её состояние на прошлой версии. */
const earlier = { ...terms, version: terms.version - 1, effectiveFrom: "2026-09-01" };

const meta = {
  ...environment,
  component: LegalDocumentPage,
  title: "Pages/Legal/Документ",
  args: { blocks, current: terms, edition: terms, superseded: [] },
  tags: ["autodocs"],
} satisfies Meta<typeof LegalDocumentPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Действующая редакция: так документ выглядит по своему постоянному адресу. */
export const Current: Story = {};

/** У документа есть прежние редакции: их адреса остаются рабочими. */
export const WithEarlierEdition: Story = {
  args: { current: terms, edition: terms, superseded: [earlier] },
};

/** Открыта прежняя редакция: отметка и ссылка на действующий текст. */
export const EarlierEdition: Story = {
  args: {
    blocks: parseLegalText(earlier.text),
    current: terms,
    edition: earlier,
    superseded: [earlier],
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
