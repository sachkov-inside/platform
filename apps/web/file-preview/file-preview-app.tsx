import { useEffect, useState } from "react";

import { PublicShell } from "@/_app";
import {
  MaterialReaderView,
  readerBodyLinkHref,
  resolveProductReaderContext,
} from "@/_pages/material-reader";
import { ProductTaskView } from "@/_pages/product-task";
import type { MaterialCodeHighlights } from "@/entities/material.model";
import { highlightMaterialCode } from "@/entities/material.server";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { LessonTermDeck } from "@/features/lesson-term-deck";
import { courseReadingContext } from "@/features/library-discovery";
import { SavedReadingAction } from "@/features/reading-progress";
import {
  homeMaterialReaderReturnTarget,
  parseMaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { ownSectionHref } from "@/shared/routing/reader-course-anchor";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { proseLinkClassName } from "@/shared/ui/prose-link";

import { FilePreviewIndex } from "./file-preview-index";
import { previewPageSchema, type PreviewPage } from "./file-preview-page";
import { PreviewNotice } from "./file-preview-notice";

/** The production learner MCP address, shown in the submission instructions. */
const learnerMcpUrl = "https://inside.sachkov.dev/mcp/learning";

type Loaded =
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      readonly page: PreviewPage;
      readonly codeHighlights: MaterialCodeHighlights;
    }
  | { readonly state: "failed"; readonly message: string };

/**
 * The light preview: one page of a local Content package in the site's own shell, Reader and Task
 * page. The preview server answers `/__preview/page`, signs the reader in as an author and reloads
 * the page when the package changes.
 */
export function FilePreviewApp() {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    void load(window.location.pathname).then(setLoaded);
  }, []);
  return (
    <PublicShell>
      {loaded.state === "loading" ? null : loaded.state === "failed" ? (
        <PreviewProblem message={loaded.message} />
      ) : (
        <PreviewPageView
          page={loaded.page}
          codeHighlights={loaded.codeHighlights}
        />
      )}
    </PublicShell>
  );
}

async function load(pathname: string): Promise<Loaded> {
  try {
    const response = await fetch(
      `/__preview/page?path=${encodeURIComponent(pathname)}`,
    );
    const page = previewPageSchema.parse(await response.json());
    const blocks =
      page.kind === "material"
        ? page.body
        : page.kind === "task" && page.page.access === "open"
          ? (page.page.task.page?.body.blocks ?? [])
          : [];
    return {
      state: "ready",
      page,
      codeHighlights: await highlightMaterialCode(blocks),
    };
  } catch (error) {
    return {
      state: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function PreviewPageView({
  page,
  codeHighlights,
}: {
  readonly page: PreviewPage;
  readonly codeHighlights: MaterialCodeHighlights;
}) {
  if (page.kind === "error") return <PreviewProblem message={page.message} />;
  if (page.kind === "index" || page.kind === "missing")
    return (
      <FilePreviewIndex index={page.index} missing={page.kind === "missing"} />
    );
  if (page.kind === "task") {
    if (page.page.access !== "open")
      return <PreviewProblem message="The preview opens every Task page" />;
    const { task } = page.page;
    const returnTo = productTaskHref(task.product.slug, task.code);
    return (
      <ProductTaskView
        page={page.page}
        programme={courseReadingContext({
          product: page.course,
          current: { kind: "task", code: task.code },
        })}
        learnerMcpUrl={learnerMcpUrl}
        liveSubmissions={false}
        accountId={null}
        returnTo={returnTo}
        // A learner who has not submitted yet: the preview keeps no submissions.
        submissions={{
          kind: "ready",
          code: task.code,
          currentVersion: task.version,
          nextCursor: null,
          latestSubmittedAt: null,
          versions: [],
          submissions: [],
        }}
      />
    );
  }
  return <LessonPreview page={page} codeHighlights={codeHighlights} />;
}

function LessonPreview({
  page,
  codeHighlights,
}: {
  readonly page: Extract<PreviewPage, { readonly kind: "material" }>;
  readonly codeHighlights: MaterialCodeHighlights;
}) {
  const { material, course } = page;
  const query = new URLSearchParams(window.location.search);
  // Opened without a source, a course lesson opens inside its course, as on the site.
  const returnTarget =
    query.get("from") !== null
      ? parseMaterialReaderReturnTarget(query.get("from"))
      : course === null
        ? homeMaterialReaderReturnTarget
        : parseMaterialReaderReturnTarget(
            productProgrammeHref(course.reference.slug),
          );
  const productContext =
    course === null
      ? null
      : resolveProductReaderContext({
          currentMaterialSlug: material.slug,
          placementId: query.get("placement") ?? undefined,
          referenceView: query.get("view") === "reference",
          returnTarget,
          product: course,
        });
  return (
    <MaterialReaderView
      renderLink={(href, label) => {
        const section = ownSectionHref(href, material.slug);
        if (section !== undefined)
          return (
            <a className={proseLinkClassName} href={section}>
              {label}
            </a>
          );
        const target = readerBodyLinkHref(productContext, href);
        return target === undefined ? undefined : (
          <IntentPrefetchLink className={proseLinkClassName} href={target}>
            {label}
          </IntentPrefetchLink>
        );
      }}
      topReadingAction={
        <SavedReadingAction
          compact
          materialId={material.materialId}
          format={material.format.slug}
        />
      }
      topBookmarkAction={
        <SavedBookmarkAction
          presentation="reader"
          compact
          materialId={material.materialId}
        />
      }
      body={page.body}
      codeHighlights={codeHighlights}
      glossaryTerms={page.glossaryTerms}
      termDeck={
        page.lessonTerms.length === 0 ? undefined : (
          <LessonTermDeck terms={page.lessonTerms} />
        )
      }
      material={material}
      primaryVideo={page.primaryVideo}
      returnTarget={returnTarget}
      productContext={productContext}
    />
  );
}

function PreviewProblem({ message }: { readonly message: string }) {
  return (
    <PreviewNotice title="Пакет не открывается">
      <p className="mt-3 text-body-muted">
        Предпросмотр покажет страницу, когда файлы исправят. Сайт отказал бы в
        этом пакете с той же причиной.
      </p>
      <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-muted p-4 font-mono text-sm">
        {message}
      </pre>
    </PreviewNotice>
  );
}
