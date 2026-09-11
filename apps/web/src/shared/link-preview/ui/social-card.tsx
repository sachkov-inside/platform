import { ImageResponse } from "next/og";

import { SITE_NAME } from "../model/public-page-preview";
import {
  socialCardTitle,
  socialCardTitleFontSize,
  SOCIAL_CARD_SIZE,
  type SocialCardContent,
} from "../model/social-card-content";

/**
 * Карточка живёт ровно столько, сколько выдерживает смена названия страницы: час свежести и
 * сутки на отдачу устаревшей версии, пока приходит новая.
 */
const SOCIAL_CARD_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

const INK = "#202124";
const ACCENT = "#c7461e";
const PAPER = "#ffffff";

/**
 * Единая сгенерированная карточка для страницы без собственной обложки: ссылка никогда не
 * выглядит пустой. Генератор изображения понимает только flexbox и часть свойств CSS,
 * поэтому разметка держится на вложенных `display: flex`.
 */
export function socialCardResponse(content: SocialCardContent): ImageResponse {
  const title = socialCardTitle(content.title);
  return new ImageResponse(
    (
      <div
        style={{
          backgroundColor: INK,
          color: PAPER,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "72px",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "20px" }}>
          <div
            style={{
              alignItems: "center",
              backgroundColor: PAPER,
              borderRadius: "16px",
              display: "flex",
              flexDirection: "column",
              height: "56px",
              justifyContent: "center",
              width: "56px",
            }}
          >
            <div
              style={{
                backgroundColor: ACCENT,
                borderRadius: "3px",
                display: "flex",
                height: "10px",
                width: "10px",
              }}
            />
            <div
              style={{
                backgroundColor: INK,
                display: "flex",
                height: "20px",
                marginTop: "5px",
                width: "10px",
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: "30px", letterSpacing: "-0.5px" }}>
            {SITE_NAME}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {content.eyebrow === undefined ? null : (
            <div
              style={{
                color: ACCENT,
                display: "flex",
                fontSize: "28px",
                letterSpacing: "4px",
                textTransform: "uppercase",
              }}
            >
              {content.eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: `${String(socialCardTitleFontSize(title))}px`,
              letterSpacing: "-1px",
              lineHeight: 1.16,
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{ backgroundColor: ACCENT, display: "flex", height: "6px", width: "120px" }}
        />
      </div>
    ),
    {
      ...SOCIAL_CARD_SIZE,
      headers: { "cache-control": SOCIAL_CARD_CACHE_CONTROL },
    },
  );
}
