const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  if (req.method !== 'PATCH') return res.status(405).end();

  const {
    reset_hour, has_completed_onboarding, onboarding_ritual_count,
    has_shown_record_tutorial, has_shown_bazaar_tutorial, has_shown_actpool_tutorial,
  } = req.body;

  const [current] = await sql`SELECT * FROM settings_v2 WHERE user_id = ${userId}`;
  const rh   = reset_hour                   !== undefined ? reset_hour                   : (current?.reset_hour ?? 8);
  const hco  = has_completed_onboarding     !== undefined ? has_completed_onboarding     : (current?.has_completed_onboarding ?? false);
  const orc  = onboarding_ritual_count      !== undefined ? onboarding_ritual_count      : (current?.onboarding_ritual_count ?? 0);
  const hsr  = has_shown_record_tutorial    !== undefined ? has_shown_record_tutorial    : (current?.has_shown_record_tutorial ?? false);
  const hsb  = has_shown_bazaar_tutorial    !== undefined ? has_shown_bazaar_tutorial    : (current?.has_shown_bazaar_tutorial ?? false);
  const hsap = has_shown_actpool_tutorial   !== undefined ? has_shown_actpool_tutorial   : (current?.has_shown_actpool_tutorial ?? false);

  await sql`
    INSERT INTO settings_v2
      (user_id, reset_hour, has_completed_onboarding, onboarding_ritual_count,
       has_shown_record_tutorial, has_shown_bazaar_tutorial, has_shown_actpool_tutorial)
    VALUES (${userId}, ${rh}, ${hco}, ${orc}, ${hsr}, ${hsb}, ${hsap})
    ON CONFLICT (user_id) DO UPDATE SET
      reset_hour                  = ${rh},
      has_completed_onboarding    = ${hco},
      onboarding_ritual_count     = ${orc},
      has_shown_record_tutorial   = ${hsr},
      has_shown_bazaar_tutorial   = ${hsb},
      has_shown_actpool_tutorial  = ${hsap}
  `;

  res.json({ ok: true });
});
