import { Download, ExternalLink, Lock } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { formatArtifactSize } from "../model/guide-artifacts";
import {
  readerGuideArtifactFileHref,
  type ReaderGuideArtifact,
} from "../model/reader-guide-artifacts";

/**
 * The artifact section of a Guide page. A locked artifact keeps its title,
 * purpose and version so the reader knows what the Guide includes; the backend
 * withholds its bytes and its external address, and this list never invents one.
 */
export function ReaderGuideArtifacts({
  artifacts,
  guideId,
  headingLevel = "h3",
}: {
  readonly artifacts: readonly ReaderGuideArtifact[];
  readonly guideId: string;
  readonly headingLevel?: "h3" | "h4";
}) {
  const Heading = headingLevel;
  return (
    <ul aria-label="Артефакты руководства" className="grid gap-4">
      {artifacts.map((artifact) => {
        const locked = artifact.availability === "locked";
        return (
          <li
            className="grid gap-3 rounded-2xl border border-border p-5 @container/artifact sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
            data-artifact-availability={artifact.availability}
            key={artifact.artifactId}
          >
            <div className="min-w-0">
              <Heading className="break-words text-base font-semibold leading-6">
                {artifact.title}
              </Heading>
              {artifact.purpose ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {artifact.purpose}
                </p>
              ) : null}
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{describeReaderArtifactContent(artifact)}</span>
                <span className="tabular-nums">
                  Версия {artifact.version} · обновлён{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Europe/Moscow",
                    year: "numeric",
                  }).format(new Date(artifact.updatedAt))}
                </span>
              </p>
            </div>
            {locked ? (
              <span className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground sm:self-auto">
                <Lock aria-hidden="true" className="size-4" />
                Откроется с доступом
              </span>
            ) : (
              <ArtifactAction artifact={artifact} guideId={guideId} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ArtifactAction({
  artifact,
  guideId,
}: {
  readonly artifact: ReaderGuideArtifact;
  readonly guideId: string;
}) {
  const className = cn(
    "inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-primary px-5 text-sm font-semibold text-white no-underline hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:self-auto",
  );
  if (artifact.content.kind === "file") {
    return (
      <a
        className={className}
        download={artifact.content.filename}
        href={readerGuideArtifactFileHref(guideId, artifact)}
      >
        <Download aria-hidden="true" className="size-4" />
        Скачать
      </a>
    );
  }
  // A published link artifact always carries its address once access allows it.
  return artifact.content.externalUrl === null ? null : (
    <a
      className={className}
      href={artifact.content.externalUrl}
      rel="noreferrer noopener"
      target="_blank"
    >
      <ExternalLink aria-hidden="true" className="size-4" />
      Открыть
    </a>
  );
}

function describeReaderArtifactContent(artifact: ReaderGuideArtifact): string {
  return artifact.content.kind === "file"
    ? `${artifact.content.filename} · ${formatArtifactSize(artifact.content.size)}`
    : "Внешняя ссылка";
}
