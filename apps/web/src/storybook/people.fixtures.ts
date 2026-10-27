/**
 * Подставной BFF подписей людей (`/api/authoring/people/identities`) для историй чужих списков:
 * тот же ответ, что даёт маршрут `usePersonIdentities`. Аккаунт, которого нет в `people`, в ответе
 * отсутствует, как посетитель без контактов.
 */
export interface StoryPerson {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly email: string | null;
  readonly contactsState: "complete" | "partial";
}

export interface PeopleIdentitiesFake {
  readonly people: readonly StoryPerson[];
  /** Чтение отвечает этим отказом. */
  readonly failure?: "forbidden" | "unavailable";
  /** Чтение не отвечает: подписи остаются в загрузке. */
  readonly pending?: boolean;
}

/** Ответ на запрос подписей; `null`, когда запрос не к ним. */
export function peopleIdentitiesResponse(
  input: RequestInfo | URL,
  fake: PeopleIdentitiesFake,
): Promise<Response> | null {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  );
  if (url.pathname !== "/api/authoring/people/identities") return null;
  if (fake.pending === true) return new Promise<Response>(() => undefined);
  if (fake.failure === "forbidden")
    return Promise.resolve(
      Response.json({ kind: "forbidden" }, { status: 403 }),
    );
  if (fake.failure === "unavailable")
    return Promise.resolve(
      Response.json(
        { kind: "unavailable", reference: "people-story" },
        { status: 503 },
      ),
    );
  const ids = (url.searchParams.get("accountIds") ?? "")
    .split(",")
    .map((id) => id.toLowerCase());
  return Promise.resolve(
    Response.json({
      kind: "ready",
      items: fake.people.filter((person) =>
        ids.includes(person.accountId.toLowerCase()),
      ),
    }),
  );
}
