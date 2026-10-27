"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useHomePin } from "@/features/series-order";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminListHeader,
  AdminNoResults,
  AdminNotFound,
  AdminPagination,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { setContentCollectionArchive } from "../api/content-collections.browser";
import {
  COLLECTION_SEARCH_MAX,
  collectionListHref,
  collectionStateFilterLabel,
  collectionStateFilterOptions,
  filterCollections,
  formatCollectionCount,
  hasCollectionFilters,
  pageOfCollections,
  presentProductRow,
  presentTopicRow,
  withoutCollectionFilters,
  withoutOpenTopic,
  type CollectionListQuery,
  type CollectionPage,
  type CollectionStateFilter,
} from "../model/collection-list";
import type {
  ContentCollection,
  ContentCollectionKind,
  ContentCollectionMutationResult,
} from "../model/content-collections";
import {
  useCollectionListQuery,
  type CollectionListNavigation,
} from "../model/use-collection-list-query.client";
import { CollectionCreateForm } from "./collection-create-form.client";
import { MutationNotice } from "./collection-mutation-notice";
import { HomePinNotice, ProductsTable } from "./products-list.client";
import { TopicEditor } from "./topic-editor.client";
import { TopicsTable } from "./topics-list.client";

/**
 * Списки «Продукты» и «Темы» в общем образце админки (#1717). Поиск и фильтр живут в адресе;
 * список полный, поэтому сужается в браузере. Строка продукта открывает его страницу, строка темы
 * открывает тему на этой же странице по адресу `?topic=`.
 */
export function ContentCollectionsPageClient({
  initialCollections,
  kind,
}: {
  readonly initialCollections: readonly ContentCollection[];
  readonly kind: ContentCollectionKind;
}) {
  const [collections, setCollections] = useState(initialCollections);
  const [query, navigation] = useCollectionListQuery(kind);
  const applySavedCollection = (result: ContentCollectionMutationResult) => {
    if (result.kind !== "saved") return;
    setCollections((current) => {
      const existing = current.some(({ id }) => id === result.collection.id);
      const next = existing
        ? current.map((collection) =>
            collection.id === result.collection.id
              ? result.collection
              : collection,
          )
        : [...current, result.collection];
      return [...next].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    });
  };

  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">
        {kind === "series" ? (
          <ProductsSection
            collections={collections}
            navigation={navigation}
            onSaved={applySavedCollection}
            query={query}
          />
        ) : (
          <TopicsSection
            collections={collections}
            navigation={navigation}
            onSaved={applySavedCollection}
            query={query}
          />
        )}
      </div>
    </main>
  );
}

interface SectionProps {
  readonly collections: readonly ContentCollection[];
  readonly query: CollectionListQuery;
  readonly navigation: CollectionListNavigation;
  readonly onSaved: (result: ContentCollectionMutationResult) => void;
}

function ProductsSection({
  collections,
  query,
  navigation,
  onSaved,
}: SectionProps) {
  const homePin = useHomePin();
  const found = filterCollections(collections, query);
  const shown = pageOfCollections(found, query.page);
  return (
    <CollectionListFrame
      collections={collections}
      kind="series"
      onSaved={onSaved}
      query={query}
      resultCount={found.length}
      onQueryChange={navigation.replace}
    >
      <HomePinNotice homePin={homePin} />
      {found.length === 0 ? (
        <CollectionNoResults
          onReset={() => {
            navigation.replace(withoutCollectionFilters(query));
          }}
        />
      ) : (
        <>
          <ProductsTable
            homePin={homePin}
            rows={shown.rows.map(presentProductRow)}
          />
          <CollectionPagination
            kind="series"
            onPage={(page) => {
              navigation.replace({ ...query, page });
            }}
            shown={shown}
          />
        </>
      )}
    </CollectionListFrame>
  );
}

function TopicsSection({
  collections,
  query,
  navigation,
  onSaved,
}: SectionProps) {
  const router = useRouter();
  const listPath = usePathname();
  const openId = query.topicId;
  const openTopic =
    openId === undefined
      ? undefined
      : collections.find(({ id }) => id === openId);
  // Однажды открытая тема остаётся смонтированной: черновик и запись в полёте переживают возврат.
  const [mountedIds, setMountedIds] = useState<readonly string[]>(() =>
    openTopic === undefined ? [] : [openTopic.id],
  );
  if (openTopic !== undefined && !mountedIds.includes(openTopic.id))
    setMountedIds([...mountedIds, openTopic.id]);
  const archive = useMutation({
    mutationFn: setContentCollectionArchive,
    onSuccess: onSaved,
  });
  const listRef = useRef<HTMLDivElement>(null);
  useTopicFocus(openId, listRef);

  const found = filterCollections(collections, query);
  const shown = pageOfCollections(found, query.page);
  const open = (topicId: string) => {
    navigation.push({ ...query, topicId });
  };
  const close = () => {
    navigation.push(withoutOpenTopic(query));
  };

  return (
    <>
      <div className="contents" hidden={openId !== undefined} ref={listRef}>
        <CollectionListFrame
          collections={collections}
          kind="topic"
          onQueryChange={navigation.replace}
          onSaved={onSaved}
          query={query}
          resultCount={found.length}
        >
          <MutationNotice
            onRefresh={() => {
              router.refresh();
            }}
            result={archive.data ?? null}
          />
          {found.length === 0 ? (
            <CollectionNoResults
              onReset={() => {
                navigation.replace(withoutCollectionFilters(query));
              }}
            />
          ) : (
            <TopicsTable
              archivePending={archive.isPending}
              onArchive={(row) => {
                const collection = collections.find(({ id }) => id === row.id);
                if (collection === undefined) return;
                void flushPendingEdits().then((ok) => {
                  if (!ok) return;
                  archive.mutate({
                    archived: !collection.archived,
                    collectionId: collection.id,
                    expectedVersion: collection.version,
                    kind: "topic",
                  });
                });
              }}
              onOpen={(row) => {
                open(row.id);
              }}
              rowHref={(row) =>
                collectionListHref(listPath, { ...query, topicId: row.id })
              }
              rows={shown.rows.map(presentTopicRow)}
            />
          )}
          {found.length === 0 ? null : (
            <CollectionPagination
              kind="topic"
              onPage={(page) => {
                navigation.replace({ ...query, page });
              }}
              shown={shown}
            />
          )}
        </CollectionListFrame>
      </div>
      {openId !== undefined && openTopic === undefined ? (
        <AdminNotFound
          backHref={collectionListHref(listPath, withoutOpenTopic(query))}
          backLabel="Все темы"
          description="Темы с таким адресом нет. Откройте тему из списка."
          title="Тема не найдена"
        />
      ) : null}
      {mountedIds.map((id) => {
        const collection = collections.find((topic) => topic.id === id);
        if (collection === undefined) return null;
        return (
          <div className="contents" hidden={id !== openId} key={id}>
            <TopicEditor
              collection={collection}
              headingId={topicHeadingId(id)}
              onClose={close}
              onSaved={onSaved}
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * Фокус идёт за видом: открытая тема получает его на заголовке, а возврат к списку ставит его на
 * ссылку той же темы в строке.
 */
function useTopicFocus(
  openId: string | undefined,
  listRef: RefObject<HTMLDivElement | null>,
) {
  const previous = useRef(openId);
  useEffect(() => {
    const left = previous.current;
    if (left === openId) return;
    previous.current = openId;
    if (openId !== undefined) {
      document.getElementById(topicHeadingId(openId))?.focus();
      return;
    }
    const link = [
      ...(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ??
        []),
    ].find(
      (anchor) =>
        anchor.getClientRects().length > 0 &&
        new URL(anchor.href).searchParams.get("topic") === left,
    );
    link?.focus();
  }, [openId, listRef]);
}

function topicHeadingId(topicId: string): string {
  return `topic-editor-${topicId}`;
}

/** Заголовок, форма создания, поиск и фильтр архива одного списка. */
function CollectionListFrame({
  kind,
  collections,
  query,
  resultCount,
  onQueryChange,
  onSaved,
  children,
}: {
  readonly kind: ContentCollectionKind;
  readonly collections: readonly ContentCollection[];
  readonly query: CollectionListQuery;
  readonly resultCount: number;
  readonly onQueryChange: (next: CollectionListQuery) => void;
  readonly onSaved: (result: ContentCollectionMutationResult) => void;
  readonly children: ReactNode;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const createLabel = kind === "topic" ? "Создать тему" : "Создать продукт";
  const createButton = (
    <Button
      aria-expanded={createOpen}
      onClick={() => {
        setCreateOpen(!createOpen);
      }}
      type="button"
    >
      <Plus aria-hidden="true" />
      {createLabel}
    </Button>
  );
  const empty = collections.length === 0;
  const filtered = hasCollectionFilters(query);
  return (
    <>
      <AdminListHeader
        action={empty ? undefined : createButton}
        count={formatCollectionCount(kind, collections.length)}
        title={kind === "topic" ? "Темы" : "Продукты"}
      />
      {createOpen ? (
        <CollectionCreateForm
          kind={kind}
          onCreated={(result) => {
            onSaved(result);
            setCreateOpen(false);
          }}
        />
      ) : null}
      {empty ? (
        <AdminEmptyState
          action={createButton}
          description={
            kind === "topic"
              ? "Тема объединяет материалы библиотеки. Создайте первую, чтобы выбрать её в материале."
              : "Продукт собирает материалы в программу. Создайте первый, чтобы настроить его описание и состав."
          }
          title={kind === "topic" ? "Тем пока нет" : "Продуктов пока нет"}
        />
      ) : (
        <section
          aria-label={kind === "topic" ? "Список тем" : "Список продуктов"}
          className="grid gap-4"
        >
          <AdminFilterBar
            chips={
              query.state === "all"
                ? []
                : [
                    {
                      id: "state",
                      label: collectionStateFilterLabel(query.state),
                      onRemove: () => {
                        onQueryChange({ ...query, state: "all", page: 1 });
                      },
                    },
                  ]
            }
            filters={[
              {
                id: "state",
                label: "Состояние",
                value: query.state,
                options: collectionStateFilterOptions,
                onChange: (value) => {
                  onQueryChange({
                    ...query,
                    state: stateFilterOf(value),
                    page: 1,
                  });
                },
              },
            ]}
            onReset={
              filtered
                ? () => {
                    onQueryChange(withoutCollectionFilters(query));
                  }
                : undefined
            }
            resultLabel={
              filtered
                ? `Найдено: ${formatCollectionCount(kind, resultCount)}`
                : undefined
            }
            search={{
              label: kind === "topic" ? "Поиск по темам" : "Поиск по продуктам",
              placeholder: "Название",
              value: query.search,
              maxLength: COLLECTION_SEARCH_MAX,
              onChange: (search) => {
                onQueryChange({ ...query, search, page: 1 });
              },
            }}
          />
          {children}
        </section>
      )}
    </>
  );
}

function CollectionPagination({
  kind,
  shown,
  onPage,
}: {
  readonly kind: ContentCollectionKind;
  readonly shown: CollectionPage<ContentCollection>;
  readonly onPage: (page: number) => void;
}) {
  return (
    <AdminPagination
      label={kind === "topic" ? "Страницы тем" : "Страницы продуктов"}
      onPage={onPage}
      page={shown.page}
      {...(shown.summary === undefined ? {} : { summary: shown.summary })}
      totalPages={shown.totalPages}
    />
  );
}

function CollectionNoResults({ onReset }: { readonly onReset: () => void }) {
  return (
    <AdminNoResults
      description="Ни одно название не подходит под поиск и фильтр. Измените их или сбросьте."
      onReset={onReset}
    />
  );
}

function stateFilterOf(value: string): CollectionStateFilter {
  return value === "active" || value === "archived" ? value : "all";
}
