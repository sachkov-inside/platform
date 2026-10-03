import type { GuideIntroductionDraft } from "./content-collections";

/** Reader-facing wording; the field names follow the Inside Content `guide.yaml`. */
export const GUIDE_INTRODUCTION_FIELDS: readonly {
  readonly field: keyof GuideIntroductionDraft;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  {
    field: "outcome",
    label: "Что читатель сможет",
    placeholder: "Какую задачу читатель решит после прохождения продукта?",
  },
  {
    field: "audience",
    label: "Для кого",
    placeholder: "Кому этот продукт полезен?",
  },
  {
    field: "prerequisites",
    label: "Что нужно знать заранее",
    placeholder: "Какие знания и опыт нужны до начала?",
  },
  {
    field: "scope",
    label: "Что разбираем и что остаётся за границами",
    placeholder: "Что входит в продукт, а что нет и что ещё готовится?",
  },
];
