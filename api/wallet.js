const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method !== 'PATCH') return res.status(405).end();

  const {
    common, legendary, mythic, streak,
    last_purchase_date, last_purchase_item_name, last_purchase_item_rarity,
  } = req.body;

  await sql`
    INSERT INTO wallet_v2
      (user_id, common, legendary, mythic, streak, last_purchase_date, last_purchase_item_name, last_purchase_item_rarity)
    VALUES
      (${userId}, ${common}, ${legendary}, ${mythic}, ${streak ?? 0}, ${last_purchase_date ?? null}, ${last_purchase_item_name ?? null}, ${last_purchase_item_rarity ?? null})
    ON CONFLICT (user_id) DO UPDATE SET
      common                    = EXCLUDED.common,
      legendary                 = EXCLUDED.legendary,
      mythic                    = EXCLUDED.mythic,
      streak                    = EXCLUDED.streak,
      last_purchase_date        = EXCLUDED.last_purchase_date,
      last_purchase_item_name   = EXCLUDED.last_purchase_item_name,
      last_purchase_item_rarity = EXCLUDED.last_purchase_item_rarity
  `;

  res.json({ ok: true });
});
