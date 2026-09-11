/** Ссылку на операцию добавляет контейнер, поэтому форма её не собирает. */
export type AdminCommand<Input> = Omit<Input, "operationId">;
