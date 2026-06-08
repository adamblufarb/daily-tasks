const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method !== 'PATCH') return res.status(405).end();

  const { reset_hour } = req.body;
  await sql`
    INSERT INTO settings_v2 (user_id, reset_hour)
    VALUES (${userId}, ${reset_hour})
    ON CONFLICT (user_id) DO UPDATE SET reset_hour = EXCLUDED.reset_hour
  `;

  res.json({ ok: true });
});
