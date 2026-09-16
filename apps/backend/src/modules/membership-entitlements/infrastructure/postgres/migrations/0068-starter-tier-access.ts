export const name = "0068_starter_tier_access";

const allGuides = `'{"guideIds":[],"materialIds":[],"allGuides":true}'::jsonb`;

/**
 * Стартовый тариф даёт то же, что подписка: материалы всех продуктов платформы, включая новые,
 * сопровождение и общую группу. Тариф правится на месте, пока его никому не назначили: снимков
 * этой редакции ещё нет. Мост прежних участников открывает тот же состав, а не снимок каталога на
 * дату миграции 0063, и не несёт `reviews`, которое не выдаёт ни одно основание. Решение владельца
 * от 15.09.2026 (Workspace #183, «кабинет и тариф») переименовывает тариф в «Подписка Inside».
 */
export const statement = `
UPDATE billing.offers
   SET name = 'Подписка Inside',
       benefits = ARRAY['community','materials','support']::text[],
       content_scope = ${allGuides}
 WHERE id = '62000000-0000-4000-8000-000000000624'::uuid
   AND NOT EXISTS (
     SELECT 1 FROM membership_entitlements.subscription_enrollments
      WHERE tier_id = '62000000-0000-4000-8000-000000000624'::uuid
   );
UPDATE membership_entitlements.legacy_classifications
   SET bridge_content_scope = ${allGuides},
       bridge_benefits = array_remove(bridge_benefits, 'reviews')
 WHERE bridge_enabled OR bridge_content_scope IS NOT NULL OR 'reviews' = ANY(bridge_benefits);
CREATE OR REPLACE FUNCTION membership_entitlements.freeze_bridge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.bridge_enabled AND NEW.bridge_content_scope IS NULL THEN
  NEW.bridge_content_scope := ${allGuides};
 END IF;
 RETURN NEW;
END $$;
`;
