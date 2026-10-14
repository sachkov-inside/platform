import { Check } from "lucide-react";

/** Shared presentation for checkout and Product onboarding. State belongs to the caller. */
export function JourneyProgress({
  labels,
  current,
  completed = false,
  label,
}: {
  readonly labels: readonly string[];
  readonly current: number;
  readonly completed?: boolean;
  readonly label: string;
}) {
  return (
    <ol
      aria-label={label}
      className="grid grid-cols-3 gap-3 text-xs font-semibold"
    >
      {labels.map((text, index) => (
        <li
          key={text}
          aria-current={!completed && index === current ? "step" : undefined}
          className={
            index > current ? "text-muted-foreground" : "text-foreground"
          }
        >
          <span
            aria-hidden="true"
            className={`mb-3 block h-1 rounded-full ${completed || index < current ? "bg-foreground" : index === current ? "bg-accent" : "bg-muted"}`}
          />
          <span className="flex items-start gap-1.5">
            {completed || index < current ? (
              <Check aria-hidden="true" className="size-3 shrink-0" />
            ) : (
              <span>{index + 1}.</span>
            )}
            {text}
          </span>
        </li>
      ))}
    </ol>
  );
}
