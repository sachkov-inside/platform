import {
  glossaryDefinitionParagraphs,
  type GlossaryTerm,
} from "../../model/glossary-term";
import { MaterialCallout } from "../material-blocks/material-callout";

/**
 * Карточка `> [!definition] term:<id>`: врезка «Определение» с полным определением из словаря.
 * Определение автора в тексте урока остаётся; карточка даёт то, что под термином обычно понимают.
 */
export function GlossaryDefinitionCard({
  term,
}: {
  readonly term: GlossaryTerm;
}) {
  return (
    <MaterialCallout
      tone="definition"
      title={
        term.englishTitle === null
          ? term.title
          : `${term.title} (${term.englishTitle})`
      }
    >
      <div data-glossary-definition={term.id}>
        {glossaryDefinitionParagraphs(term.fullDefinition).map(
          (paragraph, index) => (
            <p className="mt-2" key={index}>
              {paragraph}
            </p>
          ),
        )}
      </div>
    </MaterialCallout>
  );
}
