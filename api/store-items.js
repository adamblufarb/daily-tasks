const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  // POST — create or update a store item
  if (req.method === 'POST') {
    const { id, name, desc, cost, rarity } = req.body;
    await sql`
      INSERT INTO store_items_v2 (id, user_id, name, description, cost, rarity)
      VALUES (${id}, ${userId}, ${name}, ${desc || ''}, ${cost}, ${rarity})
      ON CONFLICT (user_id, id) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        cost        = EXCLUDED.cost,
        rarity      = EXCLUDED.rarity
    `;
    return res.json({ ok: true });
  }

  // DELETE — ?id=xxx
  if (req.method === 'DELETE') {
    const { id } = req.query;
    await sql`DELETE FROM store_items_v2 WHERE id = ${id} AND user_id = ${userId}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
});
