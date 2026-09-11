import { permanentRedirect } from "next/navigation";

/** Прежний адрес формы контакта: сама форма живёт внутри раздела «Покупки». */
export default function BillingContactRoute(): never {
  permanentRedirect("/account/purchases");
}
