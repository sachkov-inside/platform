// Both URL generations render the same production route throughout the migration.
export { default, generateMetadata } from "../../../series/[slug]/buy/page";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0026). */
export const instant = false;
