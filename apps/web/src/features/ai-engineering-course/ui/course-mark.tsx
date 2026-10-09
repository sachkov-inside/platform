/**
 * Знак курса AI Engineering (вариант B, выбор владельца 09.10.2026): тёмная плитка, белая
 * монограмма «AI» и оранжевый курсор терминала. Знак повторяет название рядом с ним, поэтому
 * скрыт от скринридера. Размер задаёт место через `className`.
 */
export function CourseMark({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 96 96"
    >
      <rect height="96" rx="24" style={{ fill: "var(--primary)" }} width="96" />
      <text
        fontSize="40"
        fontWeight="800"
        letterSpacing="-2"
        style={{
          fill: "var(--primary-foreground)",
          fontFamily: "var(--font-body), sans-serif",
        }}
        x="17"
        y="62"
      >
        AI
      </text>
      <rect
        height="6"
        rx="2"
        style={{ fill: "var(--accent)" }}
        width="14"
        x="66"
        y="56"
      />
    </svg>
  );
}
