import { fn } from "storybook/test";

import { readingFixture } from "@/storybook/reading.fixtures";

/** Производственный модуль тянет в сборку тестовую подмену и пример каталога. */
export const readingPanel = { ...readingFixture, onOpen: fn() };
