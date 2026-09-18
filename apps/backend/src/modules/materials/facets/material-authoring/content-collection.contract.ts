export type ContentCollectionKind = "guide" | "series" | "topic";

/**
 * Author-written fields that tell a reader who a Guide is for, what they will be
 * able to do, what they must know beforehand, and what stays outside it. Field
 * names follow the Inside Content authoring `guide.yaml`, so an import carries
 * the authored text without translation. A Topic has no introduction.
 */
/** One introduction field holds an authored paragraph, not a headline. */
export const GUIDE_INTRODUCTION_FIELD_MAX = 4000;

export interface GuideIntroductionDto {
  readonly audience: string;
  readonly outcome: string;
  readonly prerequisites: string;
  readonly scope: string;
}

export interface ContentCollectionDto {
  readonly archived: boolean;
  readonly id: string;
  readonly introduction: GuideIntroductionDto | null;
  readonly kind: ContentCollectionKind;
  readonly materialCount: number;
  readonly name: string;
  /** Описание страницы Guide из авторского оригинала; `null` — описания нет или оно нечитаемо. */
  readonly page: GuidePage | null;
  /** Сохранённое описание не проходит схему этого выпуска: перенос обязан перезаписать его. */
  readonly pageRejected: boolean;
  /** Оформление страницы Guide (ADR 0026); у Topic его нет. */
  readonly presentation: string | null;
  readonly slug: string;
  /** Ключ авторского оригинала, если Guide перенесён из Inside Content. */
  readonly sourceId: string | null;
  readonly summary: string;
  readonly version: number;
  readonly cover: ContentCoverProjection | null;
}
import type { ContentCoverProjection } from "../content-covers/content-covers.js";
import type { GuidePage } from "../../domain/guide-page.js";

/** Оформление и описание страницы Guide из авторского оригинала (ADR 0026). */
export interface GuideProductPageDto {
  /** Имя оформления; web показывает общий шаблон для значения, которого не знает. */
  readonly presentation: string;
  readonly page: GuidePage | null;
}
