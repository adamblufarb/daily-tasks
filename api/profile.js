const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM profiles_v2 WHERE user_id = ${userId}`;
    res.json(rows[0] || null);
    return;
  }

  if (req.method === 'PATCH') {
    const { nickname, hide_from_leaderboard, act_ftue_complete, act_ftue_answers } = req.body;

    const [current] = await sql`SELECT * FROM profiles_v2 WHERE user_id = ${userId}`;
    const nick = nickname             !== undefined ? nickname             : (current?.nickname ?? '');
    const hide = hide_from_leaderboard !== undefined ? hide_from_leaderboard : (current?.hide_from_leaderboard ?? false);
    const afc  = act_ftue_complete     !== undefined ? act_ftue_complete     : (current?.act_ftue_complete ?? false);
    const afaValue = act_ftue_answers !== undefined ? act_ftue_answers : (current?.act_ftue_answers ?? null);
    const afaJson  = afaValue === null ? null : JSON.stringify(afaValue);

    await sql`
      INSERT INTO profiles_v2 (user_id, nickname, hide_from_leaderboard, act_ftue_complete, act_ftue_answers)
      VALUES (${userId}, ${nick}, ${hide}, ${afc}, ${afaJson}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        nickname              = EXCLUDED.nickname,
        hide_from_leaderboard = EXCLUDED.hide_from_leaderboard,
        act_ftue_complete     = EXCLUDED.act_ftue_complete,
        act_ftue_answers      = EXCLUDED.act_ftue_answers
    `;
    res.json({ ok: true });
    return;
  }

  res.status(405).end();
});
