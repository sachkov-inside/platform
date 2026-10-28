/**
 * Человек в админке (#1721): подпись по решению 5, поиск людей и подписи для колонок чужих списков.
 * Все чтения требуют `billing:manage`; другая роль получает отказ, а не пустой ответ.
 */
export {
  personIdentitySchema,
  personLabel,
  shortAccountId,
  type PersonIdentity as PersonIdentityValue,
  type PersonLabel,
} from "./model/person-identity";
export { personRowLabel } from "./model/person-row-label";
export type { NameSearchState, PeopleSearchState } from "./model/people-reads";
export {
  accessOriginLabels,
  accessOriginSchema,
  peopleAccessReadsQueryKey,
  productAccessStateSchema,
  type AccessOrigin,
  type ProductAccessState,
} from "./model/person-access";
export {
  usePeopleSearch,
  usePersonIdentities,
  type PeopleSearchView,
  type PersonIdentitiesView,
} from "./model/use-people-reads.client";
export { PersonIdentity, type PersonIdentityProps } from "./ui/person-identity";
export { CopyAccountId } from "./ui/copy-account-id.client";
export {
  personRowTitle,
  usePersonTitleText,
  usePersonTitles,
} from "./ui/person-titles.client";
export {
  PeopleSearchCombobox,
  type PeopleSearchComboboxProps,
} from "./ui/people-search-combobox.client";
