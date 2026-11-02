export const name = "0119_billing_sale_notices";

// Повод `sale_recorded` сообщает авторам о подтверждённой разовой покупке. Применённая скидка
// фиксируется в самом поводе: код акции может измениться позже, а текст уже выпущенной команды
// сверяется с повторной сборкой перед отправкой. Прежние строки остаются без скидки.
export const statement = `
ALTER TABLE billing.notices DROP CONSTRAINT notices_kind_check;
ALTER TABLE billing.notices ADD CONSTRAINT notices_kind_check CHECK (kind IN ('renewal_reminder','access_ending','payment_succeeded','payment_failed','renewal_cancelled','access_expired','refund_resolved','sale_recorded'));
ALTER TABLE billing.notices ADD COLUMN promotion jsonb;
`;
