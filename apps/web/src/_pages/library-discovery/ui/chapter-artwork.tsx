import type { ReactNode } from "react";

import type { ChapterArt, ChapterTone } from "../model/chapter-tile-art";

// Линейные рисунки глав: штрих цвета текста, оранжевый акцент и «бумага» карточки. Цвета задаёт
// плитка через переменные `--art-*`, поэтому один рисунок работает на светлом и тёмном фоне.
const line = {
  fill: "none",
  stroke: "var(--art-ink)",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const paper = { ...line, fill: "var(--art-paper)" };
const accent = { ...line, fill: "var(--accent)" };
const soft = { ...line, stroke: "var(--art-soft)" };

const artwork: Readonly<Record<ChapterArt, ReactNode>> = {
  intro: (
    <>
      <path
        {...line}
        d="M44 140 C 92 142, 96 96, 140 98 S 196 124, 214 86 S 246 52, 268 50"
        strokeDasharray="2 9"
      />
      <circle {...accent} cx="44" cy="140" r="9" />
      <circle {...paper} cx="140" cy="98" r="10" />
      <path {...line} d="M135 98 l4 4 l7 -8" />
      <circle {...paper} cx="214" cy="86" r="10" />
      <path {...line} d="M268 50 V 18" />
      <path {...accent} d="M268 18 L 296 26 L 268 34 Z" />
      <rect {...paper} x="36" y="28" width="72" height="52" rx="8" />
      <path {...soft} d="M48 44 H 94 M48 56 H 86 M48 68 H 78" />
    </>
  ),
  harness: (
    <>
      <rect {...paper} x="34" y="30" width="156" height="114" rx="12" />
      <path {...line} d="M34 52 H 190" />
      <circle cx="48" cy="41" r="3" fill="var(--art-ink)" />
      <circle cx="59" cy="41" r="3" fill="var(--art-ink)" />
      <circle cx="70" cy="41" r="3" fill="var(--art-ink)" />
      <path {...line} d="M50 70 l9 7 l-9 7" />
      <path {...line} stroke="var(--accent)" d="M68 84 H 116" />
      <path {...soft} d="M50 102 H 168 M50 116 H 140 M50 130 H 154" />
      <path
        {...line}
        d="M190 88 C 204 88, 206 88, 220 88"
        strokeDasharray="1 7"
      />
      <rect {...paper} x="220" y="64" width="62" height="50" rx="14" />
      <circle cx="240" cy="88" r="4.5" fill="var(--art-ink)" />
      <circle cx="262" cy="88" r="4.5" fill="var(--art-ink)" />
      <path {...line} d="M251 64 V 48" />
      <circle {...accent} cx="251" cy="42" r="6" />
      <path {...line} d="M236 114 V 130 M266 114 V 130" />
      <rect {...paper} x="224" y="130" width="24" height="18" rx="5" />
      <rect {...accent} x="254" y="130" width="24" height="18" rx="5" />
    </>
  ),
  // Разработка настоящего продукта: коммиты ведут в окно приложения, где часть экрана уже готова
  // (чат помощника, карточка с проверкой), а следующий блок ещё строится.
  practice: (
    <>
      {/* Room in the top-left corner for the status badge of a tile. */}
      <g transform="translate(0 14)">
        <path {...line} d="M44 46 V 132" />
        <circle {...paper} cx="44" cy="46" r="7" />
        <circle {...paper} cx="44" cy="89" r="7" />
        <circle {...accent} cx="44" cy="132" r="9" />
        <path {...line} d="M53 132 H 100" strokeDasharray="1 6" />
      </g>
      <g transform="translate(14 12) scale(0.92)">
        <rect {...paper} x="96" y="22" width="198" height="136" rx="12" />
        <path {...line} d="M96 44 H 294" />
        <circle cx="110" cy="33" r="3" fill="var(--art-ink)" />
        <circle cx="121" cy="33" r="3" fill="var(--art-ink)" />
        <circle cx="132" cy="33" r="3" fill="var(--art-ink)" />
        <rect {...soft} x="146" y="28" width="104" height="10" rx="5" />
        <rect {...accent} x="112" y="56" width="120" height="24" rx="9" />
        <path
          {...line}
          stroke="var(--accent-foreground)"
          d="M124 68 H 196 M206 68 H 218"
        />
        <rect {...paper} x="112" y="88" width="166" height="24" rx="7" />
        <path {...line} d="M121 100 l5 5 l9 -10" />
        <path {...soft} d="M144 100 H 262" />
        <rect
          {...line}
          x="112"
          y="120"
          width="166"
          height="28"
          rx="7"
          strokeDasharray="5 5"
        />
        <path {...line} d="M189 134 H 201 M195 128 V 140" />
      </g>
    </>
  ),
  design: (
    <>
      <rect
        {...line}
        x="26"
        y="26"
        width="134"
        height="88"
        rx="16"
        strokeDasharray="7 7"
      />
      <rect
        {...line}
        x="176"
        y="38"
        width="118"
        height="78"
        rx="16"
        strokeDasharray="7 7"
      />
      <rect
        {...line}
        x="92"
        y="128"
        width="140"
        height="42"
        rx="14"
        strokeDasharray="7 7"
      />
      <rect {...paper} x="42" y="44" width="44" height="24" rx="6" />
      <rect {...accent} x="98" y="78" width="46" height="24" rx="6" />
      <path {...line} d="M74 68 L 104 78" />
      <rect {...paper} x="192" y="56" width="40" height="24" rx="6" />
      <rect {...paper} x="242" y="84" width="40" height="22" rx="6" />
      <path {...line} d="M222 80 L 252 84" />
      <path {...line} d="M160 72 H 176 M140 114 L 150 128" />
      <rect {...paper} x="108" y="138" width="44" height="22" rx="6" />
      <rect {...paper} x="172" y="138" width="44" height="22" rx="6" />
    </>
  ),
  mechanics: (
    <>
      <path {...line} d="M30 86 H 246" />
      {[62, 124, 186].map((cx) => (
        <g key={cx}>
          <circle {...paper} cx={cx} cy="86" r="18" />
          <path {...line} d={`M${String(cx - 7)} 86 l5 5 l10 -11`} />
        </g>
      ))}
      <rect {...accent} x="244" y="64" width="46" height="44" rx="8" />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        d="M244 80 H 290 M267 64 V 80"
      />
      <circle {...line} cx="186" cy="138" r="13" />
      <path {...line} d="M195 147 L 206 158" />
      <path
        {...soft}
        d="M44 128 H 82 M44 140 H 74 M106 128 H 142 M106 140 H 130"
      />
      <path {...soft} d="M44 34 H 94 M124 34 H 160" />
    </>
  ),
  agents: (
    <>
      <path
        {...line}
        d="M128 96 L 74 122 M192 86 L 250 116 M192 60 L 238 46"
        strokeDasharray="1 7"
      />
      <rect {...paper} x="128" y="42" width="64" height="56" rx="16" />
      <circle cx="148" cy="70" r="5" fill="var(--art-ink)" />
      <circle cx="172" cy="70" r="5" fill="var(--art-ink)" />
      <path {...line} d="M160 42 V 26" />
      <circle {...accent} cx="160" cy="20" r="6" />
      <path {...line} d="M150 98 V 114 M170 98 V 114 M140 114 H 180" />
      <ellipse {...paper} cx="58" cy="120" rx="22" ry="8" />
      <path {...paper} d="M36 120 V 150 a22 8 0 0 0 44 0 V 120" />
      <path {...line} d="M36 134 a22 8 0 0 0 44 0" />
      <circle {...paper} cx="264" cy="128" r="20" />
      <path
        {...line}
        d="M244 128 H 284 M264 108 C 252 120, 252 136, 264 148 M264 108 C 276 120, 276 136, 264 148"
      />
      <rect {...accent} x="232" y="22" width="40" height="48" rx="6" />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        d="M242 36 H 262 M242 46 H 262 M242 56 H 254"
      />
    </>
  ),
  production: (
    <>
      <rect {...paper} x="38" y="36" width="88" height="114" rx="10" />
      <path {...line} d="M38 74 H 126 M38 112 H 126" />
      {[55, 93, 131].map((cy) => (
        <g key={cy}>
          <circle cx="56" cy={cy} r="4" fill="var(--accent)" />
          <path {...soft} d={`M70 ${String(cy)} H 110`} />
        </g>
      ))}
      <rect {...paper} x="156" y="32" width="130" height="82" rx="12" />
      <path
        {...line}
        stroke="var(--accent)"
        d="M170 96 L 196 78 L 216 88 L 240 58 L 270 66"
      />
      <path {...soft} d="M170 104 H 272" />
      <rect {...paper} x="156" y="128" width="130" height="26" rx="13" />
      <circle cx="172" cy="141" r="5" fill="var(--accent)" />
      <path {...soft} d="M186 141 H 266" />
    </>
  ),
  factory: (
    <>
      <rect {...paper} x="26" y="128" width="268" height="22" rx="11" />
      {[46, 160, 274].map((cx) => (
        <circle key={cx} {...line} cx={cx} cy="139" r="5" />
      ))}
      <rect {...paper} x="52" y="98" width="32" height="30" rx="5" />
      <rect {...accent} x="124" y="98" width="32" height="30" rx="5" />
      <rect {...paper} x="230" y="98" width="32" height="30" rx="5" />
      <path
        {...line}
        d="M140 98 V 126 M124 112 H 156"
        stroke="var(--accent-foreground)"
      />
      <path {...line} d="M196 16 V 38 L 176 58 L 180 78" />
      <circle {...paper} cx="196" cy="38" r="6" />
      <circle {...paper} cx="176" cy="58" r="6" />
      <path {...line} d="M170 78 H 190 M172 78 V 88 M188 78 V 88" />
      <circle {...line} cx="262" cy="48" r="18" strokeDasharray="6 5" />
      <circle {...accent} cx="262" cy="48" r="7" />
      <path {...soft} d="M36 40 H 120 M36 54 H 96" />
    </>
  ),
  lessons: (
    <>
      <rect {...paper} x="98" y="22" width="150" height="110" rx="12" />
      <rect {...paper} x="78" y="36" width="150" height="110" rx="12" />
      <rect {...paper} x="58" y="50" width="150" height="110" rx="12" />
      <path {...line} d="M74 78 l6 6 l10 -11" />
      <path {...soft} d="M100 78 H 186" />
      <path {...line} d="M74 104 l6 6 l10 -11" />
      <path {...soft} d="M100 104 H 172" />
      <circle {...accent} cx="82" cy="134" r="8" />
      <path {...soft} d="M100 134 H 180" />
      <circle {...accent} cx="262" cy="118" r="20" />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        fill="var(--accent-foreground)"
        d="M256 108 L 272 118 L 256 128 Z"
      />
    </>
  ),
};

/** Рисунок главы на фоне её тона. Глава «в планах» рисуется приглушённо. */
export function ChapterArtwork({
  art,
  children,
  className,
  muted = false,
  tone,
}: {
  readonly art: ChapterArt;
  readonly children?: ReactNode;
  readonly className?: string | undefined;
  readonly muted?: boolean;
  readonly tone: ChapterTone;
}) {
  return (
    <div
      className={className}
      data-chapter-art={art}
      data-muted={muted ? "" : undefined}
      data-tone={tone}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 320 180">
        {artwork[art]}
      </svg>
      {children}
    </div>
  );
}
