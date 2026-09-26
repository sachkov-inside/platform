// Both URL generations render the same production route throughout the migration.
export {
  default,
  generateMetadata,
} from "../../../series/[slug]/programme/page";

/** То же окно, что у адреса `/series`: конфигурация сегмента читается из самого файла маршрута. */
export const unstable_dynamicStaleTime = 60;
