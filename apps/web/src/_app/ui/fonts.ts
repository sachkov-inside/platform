import localFont from "next/font/local";

/*
 * Шрифты площадки — те же файлы `@fontsource-variable`, что и раньше, но через `next/font`. Каждое
 * подмножество — своё объявление с прежним именем семейства и прежним `unicode-range`, в прежнем
 * порядке, поэтому вид страницы не меняется. Латиница и кириллица Manrope объявлены через
 * `<link rel="preload">`, и браузер узнаёт о них до разбора CSS. Семейства и подогнанный запасной
 * шрифт задают токены `--font-body` и `--font-utility` в `app/globals.css`: класс `next/font` под
 * Turbopack получает своё имя и с переименованным семейством не совпадает. Storybook подключает те
 * же файлы CSS-пакетами (`.storybook/preview.tsx`).
 *
 * Аргументы `localFont` Next.js читает при сборке, поэтому они записаны литералами, а каждый вызов
 * присвоен константе. Корневая раскладка и `global-error` импортируют модуль целиком.
 */
export const manropeCyrillicExt = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    { prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-cyrillic-ext-wght-normal.woff2",
  weight: "200 800",
});
export const manropeCyrillic = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    { prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" },
  ],
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2",
  weight: "200 800",
});
export const manropeGreek = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    { prop: "unicode-range", value: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-greek-wght-normal.woff2",
  weight: "200 800",
});
export const manropeVietnamese = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    {
      prop: "unicode-range",
      value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB",
    },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-vietnamese-wght-normal.woff2",
  weight: "200 800",
});
export const manropeLatinExt = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    {
      prop: "unicode-range",
      value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
    },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2",
  weight: "200 800",
});

/** Латиница последняя, как в пакете: её диапазон перекрывает общие знаки и должен побеждать. */
export const manropeLatin = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Manrope Variable'" },
    {
      prop: "unicode-range",
      value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
  src: "../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
});

/*
 * JetBrains Mono — вспомогательный шрифт кода и служебных подписей. Тот же набор: прежнее семейство,
 * диапазоны и порядок, но без preload — браузер скачает его, только когда на странице есть такой
 * текст.
 */
export const jetBrainsMonoCyrillicExt = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-ext-wght-normal.woff2",
  weight: "100 800",
});
export const jetBrainsMonoCyrillic = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2",
  weight: "100 800",
});
export const jetBrainsMonoGreek = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2",
  weight: "100 800",
});
export const jetBrainsMonoVietnamese = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2",
  weight: "100 800",
});
export const jetBrainsMonoLatinExt = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2",
  weight: "100 800",
});
export const jetBrainsMonoLatin = localFont({
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono Variable'" },
    { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
  preload: false,
  src: "../../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
});
