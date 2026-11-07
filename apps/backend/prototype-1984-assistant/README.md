# PROTOTYPE, throwaway: «Помощник: технический прототип» (#1984)

Одноразовый код. Не вливается в `main`, не переносится в реализацию.
Данные курса, вопросы из Telegram, ключи и результаты лежат вне git: `.data/` и `~/.config/inside/assistant-prototype.env`.
Репозиторий публичный, поэтому текст платных материалов сюда не коммитится.

| Шаг | Команда |
|---|---|
| База | `docker run -d --name prototype-1984-pg -e POSTGRES_PASSWORD=proto -e POSTGRES_DB=proto -p 55984:5432 pgvector/pgvector:pg18` |
| Части материалов | `node src/corpus.ts && node src/load-parts.ts` |
| Замер поиска | `node src/eval-search.ts` |
| Ход на сервере | `node src/turn-server.ts`, затем `node src/check-turn.ts tabs` или http://localhost:4984 в двух вкладках |
| Провайдер (платно) | `node src/check-provider.ts aitunnel` и `deepseek` |
