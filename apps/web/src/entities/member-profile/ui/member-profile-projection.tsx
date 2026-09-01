import { CircleUserRound } from "lucide-react";

import type { MemberProfileFields } from "../model/member-profile";

interface MemberProfileProjectionProps {
  readonly fields: MemberProfileFields;
  readonly headingLevel?: "h1" | "h2";
  readonly label?: string;
}

export function MemberProfileProjection({
  fields,
  headingLevel = "h2",
  label = "Профиль участника",
}: MemberProfileProjectionProps) {
  const Heading = headingLevel;
  const displayName = fields.displayName.trim() || "Ваше имя";
  const bio = fields.bio?.trim();

  return (
    <article className="flex min-h-72 flex-col overflow-hidden rounded-2xl border border-border bg-background p-6 sm:p-8">
      <div className="flex items-center gap-3 text-muted-foreground">
        <CircleUserRound aria-hidden="true" className="size-5 text-accent" />
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="my-auto py-10">
        <Heading className="max-w-[18ch] text-balance text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">
          {displayName}
        </Heading>
        <p className="mt-4 max-w-[54ch] whitespace-pre-line text-pretty text-base leading-7 text-muted-foreground">
          {bio === undefined || bio.length === 0
            ? "Здесь участник может коротко рассказать о себе."
            : bio}
        </p>
      </div>
      <p className="border-t border-border pt-4 font-mono text-[0.6875rem] text-muted-foreground">
        Sachkov Inside · member profile
      </p>
    </article>
  );
}
