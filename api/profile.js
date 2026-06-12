const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM profiles_v2 WHERE user_id = ${userId}`;
    res.json(rows[0] || null);
    return;
  }

  if (req.method === 'PATCH') {
    const { nickname, hide_from_leaderboard } = req.body;
    await sql`
      INSERT INTO profiles_v2 (user_id, nickname, hide_from_leaderboard)
      VALUES (${userId}, ${nickname ?? ''}, ${hide_from_leaderboard ?? false})
      ON CONFLICT (user_id) DO UPDATE SET
        nickname              = EXCLUDED.nickname,
        hide_from_leaderboard = EXCLUDED.hide_from_leaderboard
    `;
    res.json({ ok: true });
    return;
  }

  res.status(405).end();
});
