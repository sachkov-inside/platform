"use client";

import { Button } from "@/shared/ui/button";
import { useState } from "react";
import { globalAccessCapabilities } from "@inside/access-capabilities";
import {
  capabilityLabel,
  productCapability,
  type AccessCapability,
} from "@/entities/subscription";
import { presentText } from "@/shared/lib/text";

interface BenefitPeriod {
  readonly capability: AccessCapability;
  readonly months: number | null;
}

/** Maps readable benefit choices to the existing offer form contract. */
export function OfferBenefitsFields({
  benefits,
  periods,
  products,
}: {
  readonly benefits: readonly AccessCapability[];
  readonly periods: readonly BenefitPeriod[];
  readonly products: readonly { readonly id: string; readonly title: string }[];
}) {
  const [selected, setSelected] = useState(benefits);
  const [terms, setTerms] = useState<ReadonlyMap<AccessCapability, string>>(
    () =>
      new Map(
        periods.map((period) => [
          period.capability,
          period.months === null ? "permanent" : String(period.months),
        ]),
      ),
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const matchingProducts = products.filter((product) =>
    product.title
      .toLocaleLowerCase("ru")
      .includes(search.trim().toLocaleLowerCase("ru")),
  );
  const lastPage = Math.max(0, Math.ceil(matchingProducts.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleProducts = matchingProducts.slice(
    currentPage * 20,
    (currentPage + 1) * 20,
  );
  const choices = [
    ...new Set<AccessCapability>([
      ...globalAccessCapabilities,
      ...selected,
      ...visibleProducts.map((product) => productCapability(product.id)),
    ]),
  ];
  const names = new Map(
    products.map((product) => [productCapability(product.id), product.title]),
  );

  function setTerm(capability: AccessCapability, value: string) {
    setTerms((previous) => new Map(previous).set(capability, value));
  }

  return (
    <fieldset className="grid min-w-0 gap-4">
      <legend className="mb-3 text-sm font-semibold">Состав</legend>
      <p className="text-sm text-muted-foreground">
        Выберите права и при необходимости задайте отдельный срок каждого.
      </p>
      <input
        type="hidden"
        name="offerBenefits"
        value={selected
          .map((capability) => {
            const term = terms.get(capability);
            return term === undefined || term === "default"
              ? capability
              : `${capability}=${term === "permanent" ? "null" : term}`;
          })
          .join("\n")}
      />
      <label className="grid gap-1 text-sm">
        Найти продукт в составе
        <input
          className="min-h-11 rounded-lg border border-input bg-card px-3"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(0);
          }}
        />
      </label>
      <div className="grid gap-2">
        {choices.map((capability) => {
          const checked = selected.includes(capability);
          const term = terms.get(capability) ?? "default";
          const mode =
            term === "default" || term === "permanent" ? term : "months";
          const label = names.get(capability) ?? capabilityLabel(capability);
          return (
            <div className="offer-benefit-row" key={capability}>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected((previous) =>
                      checked
                        ? [...previous, capability]
                        : previous.filter((item) => item !== capability),
                    );
                  }}
                />
                {label}
              </label>
              {checked ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Срок: {label}</span>
                    <select
                      className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
                      value={mode}
                      onChange={(event) => {
                        setTerm(
                          capability,
                          event.currentTarget.value === "months"
                            ? "1"
                            : event.currentTarget.value,
                        );
                      }}
                    >
                      <option value="default">Без отдельного срока</option>
                      <option value="permanent">Бессрочно</option>
                      <option value="months">Срок в месяцах</option>
                    </select>
                  </label>
                  {mode === "months" ? (
                    <label className="w-24">
                      <span className="sr-only">Месяцев: {label}</span>
                      <input
                        className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={presentText(term) ?? ""}
                        onChange={(event) => {
                          setTerm(capability, event.currentTarget.value);
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {matchingProducts.length > visibleProducts.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => {
              setPage(currentPage - 1);
            }}
          >
            Предыдущие продукты
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {currentPage * 20 + 1}–
            {Math.min((currentPage + 1) * 20, matchingProducts.length)} из{" "}
            {matchingProducts.length}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === lastPage}
            onClick={() => {
              setPage(currentPage + 1);
            }}
          >
            Следующие продукты
          </Button>
        </div>
      ) : null}
      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Выберите хотя бы одно право.
        </p>
      ) : null}
    </fieldset>
  );
}
