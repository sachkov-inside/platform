import { SITE_NAME } from "../model/public-page-preview";
import {
  socialCardTitle,
  socialCardTitleFontSize,
  type SocialCardContent,
} from "../model/social-card-content";

/** The same artwork renders as a PNG for crawlers and scales inside the author editor. */
const INK = "#202124";
const ACCENT = "#c7461e";
const PAPER = "#ffffff";

/**
 * Единая сгенерированная карточка для страницы без собственной обложки: ссылка никогда не
 * выглядит пустой. Генератор изображения понимает только flexbox и часть свойств CSS,
 * поэтому разметка держится на вложенных `display: flex`.
 */
export function SocialCardArtwork({
  content,
  responsive = false,
}: {
  readonly content: SocialCardContent;
  readonly responsive?: boolean;
}) {
  const length = (pixels: number) =>
    responsive ? `${String(pixels / 12)}cqw` : `${String(pixels)}px`;
  const title = socialCardTitle(content.title);
  return (
    <div
      style={{
        backgroundColor: INK,
        color: PAPER,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: length(72),
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: length(20) }}>
        <div
          style={{
            alignItems: "center",
            backgroundColor: PAPER,
            borderRadius: length(16),
            display: "flex",
            height: length(56),
            justifyContent: "center",
            width: length(56),
          }}
        >
          <svg height={length(48)} viewBox="0 0 48 48" width={length(48)}>
            <path
              d="M33 14H23a10 10 0 0 0 0 20h10"
              fill="none"
              stroke={INK}
              strokeLinecap="round"
              strokeWidth="6"
            />
            <path
              d="M28 14h5"
              fill="none"
              stroke={ACCENT}
              strokeLinecap="round"
              strokeWidth="6"
            />
          </svg>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: length(30),
            letterSpacing: length(-0.5),
          }}
        >
          {SITE_NAME}
        </div>
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", gap: length(24) }}
      >
        {content.eyebrow === undefined ? null : (
          <div
            style={{
              color: PAPER,
              display: "flex",
              fontSize: length(28),
              letterSpacing: length(4),
              textTransform: "uppercase",
            }}
          >
            {content.eyebrow}
          </div>
        )}
        <div
          style={{
            display: "flex",
            fontSize: length(socialCardTitleFontSize(title)),
            letterSpacing: length(-1),
            lineHeight: 1.16,
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          backgroundColor: ACCENT,
          display: "flex",
          height: length(6),
          width: length(120),
        }}
      />
    </div>
  );
}
