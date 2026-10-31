# AI Engineering landing v2: plan and prototype

Prototype branch: `prototype/ai-engineering-landing-v2`. Throwaway Storybook proof; production
imports nothing from it.

## Question

How should the AI Engineering course landing show the engineering base, the Spec-Driven
Development method and the author's position, so that a reader (including a beginner) sees more
than "harness setup and agent tooling"?

## Owner decisions (2026-10-30)

Accepted:

1. Fix the topic illustrations: art is bound to topic order, and production content order drifted
   (RAG, «Контроль агентов», «Evals и эксплуатация», «Экономия токенов», «Работа с контекстом»
   show another topic's art). Bind art to the topic, not its index.
2. First-person voice: «Вопросы мне», «Мой менторинг» in place of «автору», as
   `apps/web/PRODUCT.md` requires.
3. Hero: concrete promise built on the owner's position (writing code loses value; business
   logic, domain, infrastructure and product development gain it; AI Software / Product Engineer).
   Highlights include «Подойдёт и начинающим».
4. New section «Моя позиция»: owner's position plus a before → after table.
5. New section «Метод курса: разработка от спецификации (SDD)»: artifact layers with who does
   what (you or the agent).
6. New block «Как это выглядит внутри»: real-looking project artifacts.
7. «Что изучим» split into two layers: engineering base and AI engineering.
8. New FAQ items: beginners, difference from free agent courses, SDD depth, own project,
   time per week.
9. «Что даёт курс» tied to concrete skills.
10. Programme: rename the second chapter and lessons 9 and 16 so the method is visible.

Declined: rigour ladder, course project section, programme on the landing, approach comparison,
moving free lessons. Not answered yet: separate beginners section (item 9 of the proposal),
showing Platform itself as proof, letter for a manager.

## Prototype

- Story: `Prototypes/AI Engineering landing v2` with three hero variants (A, B, C); the rest of the
  page is identical across variants.
- Files in `apps/web/src/_pages/library-discovery/ui/`:
  `ai-engineering-landing-v2-prototype.stories.tsx`, `ai-engineering-landing-v2.prototype.tsx`,
  `ai-engineering-landing-v2.prototype-content.ts`, `ai-engineering-landing-v2.prototype.css`.
- Baseline text: live `sachkov.dev/products/ai-engineering` on 2026-10-30, with the changes above.
- New sections are expressed with existing product-page block kinds (`text`, `cards`) and new
  block `id`s, so the copy can later live in Inside Content without a schema change. Only the
  artifact fragments are static presentation.

## Limitations

- Artifact fragments are illustrative drafts on the course topics (sessions, schema per module).
  Replace them with real fragments from the course project before production.
- «Сколько времени нужно в неделю?» has no hour estimate; the owner supplies it.
- Programme renames (decision 10) are Inside Content changes and are not part of this prototype.

## After acceptance

1. Owner picks a hero variant and annotates the sections.
2. Production ticket: renderers for the new block ids in `ai-engineering-course-view.tsx`, topic
   art bound by topic, stories; copy moves to Inside Content.
3. Content change: programme renames and the FAQ hour estimate.

## Revision 2 (2026-10-31): less text

Owner feedback: walls of text, sections overloaded, hero lead longer than two or three lines.

- Hero leads cut to one sentence, at most two lines.
- «Моя позиция»: one thesis, a role diagram (agent and you as topic chips) and five one-line
  «было → стало» rows.
- Method: an eight-step track with role colours; step paragraphs removed.
- Artifacts: one repository window with a file list and one visible file in place of four code
  blocks.
- «Что изучим»: two topic clouds without descriptions.
- Other sections: copy cut about in half; eyebrows above headings removed.
- FAQ: merged with the owner's frequent questions (no IT experience, already using agents, tasks
  do not block lessons, own project, what is ready, updates, paying for AI tools). The question
  about hours per week is merged into «Есть ли сроки или дедлайны?».

## Revision 3 (2026-10-31): original hero

The owner kept the original hero lead («AI не заменит инженера, который умеет с ним работать…»),
so hero variants A, B and C are removed and the story is one page. The first «было → стало» row
reads «Запутанная кодовая база» in place of «Код где придётся».
