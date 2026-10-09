import type { ReactNode } from "react";

import { MaterialBodyView, type RenderedBlock } from "@/entities/material";
import {
  MaterialResponsiveImage,
  type MaterialImageSource,
} from "@/features/material-assets";

import type { OpenProductTask } from "../model/product-task-page";

/** The Content page uses the same document renderer as a lesson and Task-authorized assets. */
export function TaskPageBody({
  page,
  productSlug,
  code,
  children,
}: {
  readonly children?: ReactNode;
  readonly page: NonNullable<OpenProductTask["task"]["page"]>;
  readonly productSlug: string;
  readonly code: string;
}) {
  const assetHref = (assetId: string) =>
    `/api/products/${encodeURIComponent(productSlug)}/tasks/${encodeURIComponent(code)}/assets/${encodeURIComponent(assetId)}`;
  const materialsIndex = page.body.blocks.findIndex(
    (block) =>
      block.kind === "heading" &&
      block.content.map((part) => part.text).join("") === "Материалы к заданию",
  );
  const hintAt = materialsIndex === -1 ? undefined : materialsIndex;
  const body = (
    <MaterialBodyView
      blocks={page.body.blocks}
      path={[]}
      hint={children}
      hintAt={hintAt}
      rendering={{
        headingId: (path) => `task-section-${path.join("-")}`,
        image: (block) => <TaskImage block={block} assetHref={assetHref} />,
        file: (block) => (
          <a
            className="inline-flex min-h-11 items-center underline underline-offset-4"
            href={assetHref(block.assetId)}
          >
            {block.label}
          </a>
        ),
      }}
    />
  );
  return (
    <>
      {page.cover === null ? null : (
        <figure className="mb-8 overflow-hidden rounded-xl">
          {/* The Task route authorizes this cover with the reader's session. */}
          {/* oxlint-disable-next-line next/no-img-element -- Task-authorized delivery uses the viewer session. */}
          <img
            className="h-auto w-full"
            alt={page.cover.alt}
            src={assetHref(page.cover.assetId)}
            loading="lazy"
            decoding="async"
          />
        </figure>
      )}
      {body}
      {page.artifacts.length === 0 ? null : (
        <section aria-label="Файлы задания" className="mt-6">
          <ul className="grid gap-2">
            {page.artifacts.map((artifact) => (
              <li key={artifact.sourceId}>
                <a
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href={assetHref(artifact.assetId)}
                >
                  {artifact.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {materialsIndex === -1 ? children : null}
    </>
  );
}

function TaskImage({
  block,
  assetHref,
}: {
  readonly block: Extract<RenderedBlock, { kind: "image" }>;
  readonly assetHref: (assetId: string) => string;
}) {
  const width = block.width;
  const height = block.height;
  if (width === undefined || height === undefined)
    return <p role="status">Изображение временно недоступно.</p>;
  const source = (asset: {
    readonly assetId: string;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  }): MaterialImageSource | undefined =>
    asset.width === undefined || asset.height === undefined
      ? undefined
      : {
          width: asset.width,
          height: asset.height,
          src: assetHref(asset.assetId),
          srcSet: "",
          viewerSize: { width: asset.width, height: asset.height },
        };
  const wideLight =
    block.imageVariants === undefined
      ? undefined
      : source(block.imageVariants.wideLight);
  const wideDark =
    block.imageVariants === undefined
      ? undefined
      : source(block.imageVariants.wideDark);
  const tallLight =
    block.imageVariants === undefined
      ? undefined
      : source(block.imageVariants.tallLight);
  const tallDark =
    block.imageVariants === undefined
      ? undefined
      : source(block.imageVariants.tallDark);
  const imageVariants =
    wideLight !== undefined &&
    wideDark !== undefined &&
    tallLight !== undefined &&
    tallDark !== undefined
      ? { wideLight, wideDark, tallLight, tallDark }
      : undefined;
  if (block.imageVariants !== undefined && imageVariants === undefined)
    return <p role="status">Изображение временно недоступно.</p>;
  return (
    <figure
      className="mx-auto overflow-hidden rounded-xl bg-card"
      style={{ width: `${String(block.displayWidthPercent ?? 100)}%` }}
    >
      <MaterialResponsiveImage
        alt={block.alt}
        caption={block.caption}
        image={{
          width,
          height,
          src: assetHref(block.assetId),
          srcSet: "",
          viewerSize: { width, height },
        }}
        imageVariants={imageVariants}
        preview={false}
      />
      {block.caption === undefined ? null : (
        <figcaption className="px-2 py-2 text-center text-sm text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
