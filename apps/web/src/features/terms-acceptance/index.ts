/**
 * Экран первого входа: условия использования принимаются кнопкой, и до этого закрыты кабинет,
 * покупки и связка с ботом. Серверная проверка и BFF — в `terms-acceptance.server`.
 */
export { safeReturnPath, welcomePath } from "./model/terms-acceptance";
export { WelcomeScreen } from "./ui/welcome-screen.client";
export { WelcomeView } from "./ui/welcome-view";
