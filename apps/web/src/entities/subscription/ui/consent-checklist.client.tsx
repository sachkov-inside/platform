"use client";
import {
  legalDocumentLabel,
  type LegalDocument,
  type LegalDocumentKind,
} from "../model/legal-documents";

export interface ConsentChecklistProps {
  readonly documents: readonly LegalDocument[];
  readonly accepted: readonly LegalDocumentKind[];
  readonly legend: string;
  readonly namePrefix: string;
  /** Какие согласия обязательны здесь: у подписки и разовой покупки они разные. */
  readonly required: readonly LegalDocumentKind[];
  readonly disabled?: boolean;
  /** Отмечать необязательные согласия отдельно нужно только в оформлении покупки. */
  readonly markOptional?: boolean;
  readonly onToggle: (kind: LegalDocumentKind) => void;
}

/**
 * Согласия принимаются раздельно и ни одно не отмечено заранее, включая согласие на списания.
 */
export function ConsentChecklist({
  documents,
  accepted,
  legend,
  namePrefix,
  required,
  disabled = false,
  markOptional = false,
  onToggle,
}: ConsentChecklistProps) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <ul className="mt-3 grid gap-3">
        {documents.map((document) => (
          <li key={`${document.kind}:${document.documentId}`}>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input
                checked={accepted.includes(document.kind)}
                className="mt-1 size-5 shrink-0 rounded border-input accent-primary"
                disabled={disabled}
                name={`${namePrefix}-${document.kind}`}
                onChange={() => {
                  onToggle(document.kind);
                }}
                type="checkbox"
              />
              <span className="min-w-0">
                Принимаю{" "}
                <a
                  className="text-action underline underline-offset-4"
                  href={document.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {legalDocumentLabel(document.kind)}
                </a>
                {markOptional && !required.includes(document.kind) ? (
                  <span className="text-muted-foreground"> · по желанию</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
