export const name = "0067_starter_tier_access";

/**
 * Стартовый тариф даёт то же, что подписка: материалы, сопровождение и общую группу, а его состав
 * называет только продукты. Тариф правится на месте, пока его никому не назначили: снимков этой
 * редакции ещё нет. Назначенный тариф владелец меняет новой редакцией и расширением назначений.
 */
export const statement = `
UPDATE billing.offers
   SET benefits = ARRAY['community','materials','support']::text[],
       content_scope = jsonb_set(content_scope, '{materialIds}', '[]'::jsonb)
 WHERE id = '62000000-0000-4000-8000-000000000624'::uuid
   AND content_scope IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM membership_entitlements.subscription_enrollments
      WHERE tier_id = '62000000-0000-4000-8000-000000000624'::uuid
   );
`;
