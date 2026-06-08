const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method !== 'POST') return res.status(405).end();

  await Promise.all([
    sql`DELETE FROM daily_sessions_v2 WHERE user_id = ${userId}`,
    sql`DELETE FROM wallet_v2 WHERE user_id = ${userId}`,
    sql`
      INSERT INTO settings_v2 (user_id, reset_hour, has_completed_onboarding, onboarding_ritual_count)
      VALUES (${userId}, 8, false, 0)
      ON CONFLICT (user_id) DO UPDATE SET
        has_completed_onboarding = false,
        onboarding_ritual_count = 0
    `,
  ]);

  res.json({ ok: true });
});
