"use client";
import Link from "next/link";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import styles from "./broadcasts.module.css";
import { BroadcastList } from "./broadcast-list";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { communicationsQueries } from "../model/communications-queries";
import * as api from "../api/broadcasts.browser";
import {
  type Broadcast,
  type Contact,
  type Funnel,
  errorMessage,
} from "../model/broadcasts";
import {
  BroadcastEditor,
  applyBroadcastResult,
  fieldClass,
} from "./broadcast-editor.client";
import { AnalyticsPanel, EntryHistory } from "./analytics-panel";

export function CommunicationsPage() {
  const queries = useQueryClient();
  const [cursor, setCursor] = useState<string>();
  const [funnelCursor, setFunnelCursor] = useState<string>();
  const [knownFunnels, setKnownFunnels] = useState<Funnel[]>([]);
  const [selected, setSelected] = useState<Broadcast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<{
    broadcastId?: string;
    funnelId?: string;
  }>({});
  const [contactCursor, setContactCursor] = useState<string>();
  const [deliveryCursor, setDeliveryCursor] = useState<string>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [entryCursor, setEntryCursor] = useState<string>();
  const broadcasts = useQuery(communicationsQueries.broadcasts(cursor));
  const funnelPage = useQuery(communicationsQueries.funnels(funnelCursor));
  const funnels = [
    ...new Map(
      [
        ...knownFunnels,
        ...(funnelPage.data?.kind === "ready" ? funnelPage.data.funnels : []),
      ].map((f) => [f.funnelId, f]),
    ).values(),
  ];
  const statistics = useQuery(
    communicationsQueries.statistics(scope, contactCursor),
  );
  const deliveries = useQuery(
    communicationsQueries.deliveries(scope, deliveryCursor),
  );
  const history = useQuery(
    communicationsQueries.entries(contact?.contactId, entryCursor),
  );
  const onSuccess = (result: Awaited<ReturnType<typeof api.saveBroadcast>>) => {
    applyBroadcastResult(result, setSelected, setError);
    void queries.invalidateQueries({ queryKey: ["communications"] });
  };
  const save = useMutation({ mutationFn: api.saveBroadcast, onSuccess });
  const launch = useMutation({ mutationFn: api.launchBroadcast, onSuccess });
  const pause = useMutation({ mutationFn: api.pauseBroadcast, onSuccess });
  const resume = useMutation({ mutationFn: api.resumeBroadcast, onSuccess });
  const cancel = useMutation({ mutationFn: api.cancelBroadcast, onSuccess });
  const load = useMutation({ mutationFn: api.readBroadcast, onSuccess });
  const template = useMutation({ mutationFn: api.resolveTemplate });
  const pending =
    save.isPending ||
    launch.isPending ||
    pause.isPending ||
    resume.isPending ||
    cancel.isPending ||
    load.isPending;
  function selectScope(value: string) {
    const [kind, id] = value.split(":");
    setScope(
      kind === "funnel" && id
        ? { funnelId: id }
        : kind === "broadcast" && id
          ? { broadcastId: id }
          : {},
    );
    setContactCursor(undefined);
    setDeliveryCursor(undefined);
    setContact(null);
  }
  return (
    <main
      id="authoring-content"
      tabIndex={-1}
      className="h-full overflow-y-auto bg-background px-4 pb-24 pt-5 text-foreground sm:px-6"
    >
      <div className={styles.page}>
        <Link
          className="flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          href="/authoring/communications"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Воронки Telegram
        </Link>
        <header className={styles.header}>
          <div className="space-y-3">
            <p className={styles.eyebrow}>Коммуникации · Telegram</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Рассылки и аналитика
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Разовые сообщения контактам Inside и наблюдаемые входы и переходы.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() => {
                setError(null);
                setSelected({
                  broadcastId: crypto.randomUUID(),
                  revision: 0,
                  state: "draft",
                  parts: [
                    {
                      partId: crypto.randomUUID(),
                      content: {
                        type: "text",
                        text: "",
                        entities: [],
                        buttons: [],
                      },
                    },
                  ],
                  audience: { kind: "all" },
                  scheduledAt: null,
                  audienceSnapshotId: null,
                  snapshotSize: 0,
                });
              }}
            >
              <Plus aria-hidden="true" className="size-4" /> Новая рассылка
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void queries.invalidateQueries({
                  queryKey: ["communications"],
                });
              }}
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Обновить
              данные
            </Button>
          </div>
        </header>
        <BroadcastList
          result={broadcasts.data}
          pending={pending}
          selectedId={selected?.broadcastId}
          hasPrevious={Boolean(cursor)}
          onSelect={(broadcastId) => {
            setError(null);
            load.mutate(broadcastId);
          }}
          onNext={setCursor}
          onFirst={() => {
            setCursor(undefined);
          }}
        />
        {funnelPage.data?.kind === "error" ? (
          <p role="alert">Воронки: {errorMessage(funnelPage.data.code)}</p>
        ) : null}
        {funnelPage.data?.kind === "ready" && funnelPage.data.nextCursor ? (
          <Button
            variant="outline"
            onClick={() => {
              setKnownFunnels(funnels);
              setFunnelCursor(
                funnelPage.data?.kind === "ready"
                  ? (funnelPage.data.nextCursor ?? undefined)
                  : undefined,
              );
            }}
          >
            Загрузить ещё воронки
          </Button>
        ) : null}
        {selected ? (
          <BroadcastEditor
            key={`${selected.broadcastId}:${String(selected.revision)}`}
            broadcast={selected}
            funnels={funnels}
            pending={pending}
            error={error}
            onSave={(input) => {
              save.mutate(input);
            }}
            onLaunch={(input) => {
              launch.mutate(input);
            }}
            onPause={(input) => {
              pause.mutate(input);
            }}
            onResume={(input) => {
              resume.mutate(input);
            }}
            onCancel={(input) => {
              cancel.mutate(input);
            }}
            onRefresh={() => {
              load.mutate(selected.broadcastId);
            }}
            onTemplate={async (reference) => {
              const result = await template.mutateAsync({
                reference,
                operationId: crypto.randomUUID(),
              });
              return result.kind === "ready"
                ? {
                    partId: crypto.randomUUID(),
                    content: result.template.content,
                  }
                : null;
            }}
          />
        ) : error ? (
          <p role="alert">{errorMessage(error)}</p>
        ) : null}
        <section
          aria-labelledby="analytics-title"
          className="min-w-0 space-y-4 border-t border-border pt-8"
        >
          <h2 id="analytics-title" className="text-xl font-semibold">
            Аналитика
          </h2>
          <label className="block max-w-xl text-sm font-medium">
            Показать
            <select
              className={fieldClass}
              value={
                scope.funnelId
                  ? `funnel:${scope.funnelId}`
                  : scope.broadcastId
                    ? `broadcast:${scope.broadcastId}`
                    : "all"
              }
              onChange={(event) => {
                selectScope(event.target.value);
              }}
            >
              <option value="all">Все коммуникации</option>
              {funnels.map((f) => (
                <option key={f.funnelId} value={`funnel:${f.funnelId}`}>
                  Воронка: {f.name}
                </option>
              ))}
              {broadcasts.data?.kind === "ready"
                ? broadcasts.data.broadcasts.map((b) => (
                    <option
                      key={b.broadcastId}
                      value={`broadcast:${b.broadcastId}`}
                    >
                      Рассылка:{" "}
                      {b.parts
                        .find((p) => p.content.text)
                        ?.content.text.slice(0, 35) ?? b.broadcastId}
                    </option>
                  ))
                : null}
              {selected &&
              !(
                broadcasts.data?.kind === "ready" &&
                broadcasts.data.broadcasts.some(
                  (b) => b.broadcastId === selected.broadcastId,
                )
              ) &&
              selected.revision > 0 ? (
                <option value={`broadcast:${selected.broadcastId}`}>
                  Выбранная рассылка
                </option>
              ) : null}
            </select>
          </label>
          {contactCursor || deliveryCursor ? (
            <Button
              variant="outline"
              onClick={() => {
                setContactCursor(undefined);
                setDeliveryCursor(undefined);
              }}
            >
              К началу аналитики
            </Button>
          ) : null}
          <AnalyticsPanel
            result={statistics.data}
            funnels={funnels}
            deliveries={deliveries.data}
            onContact={(value) => {
              setContact(value);
              setEntryCursor(undefined);
            }}
            onNextContacts={setContactCursor}
            onNextDeliveries={setDeliveryCursor}
          />
          {contact ? (
            <section
              className="mt-5 space-y-3 rounded-lg border border-border p-4"
              aria-label="История входов контакта"
            >
              <h3 className="break-all font-semibold">
                История контакта {contact.contactId}
              </h3>
              {!history.data ? (
                <p role="status">Загружаем входы…</p>
              ) : history.data.kind === "error" ? (
                <p role="alert">{errorMessage(history.data.code)}</p>
              ) : (
                <>
                  <EntryHistory
                    entries={history.data.entries}
                    funnels={funnels}
                  />
                  {history.data.nextCursor ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEntryCursor(
                          history.data?.kind === "ready"
                            ? (history.data.nextCursor ?? undefined)
                            : undefined,
                        );
                      }}
                    >
                      Следующие входы
                    </Button>
                  ) : null}
                </>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setContact(null);
                }}
              >
                Закрыть историю
              </Button>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
