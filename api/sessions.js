const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  // POST — upsert a session
  // body.type === 'draft'  → conditional upsert (skip if already active/done)
  // body.type === 'start'  → always overwrite
  if (req.method === 'POST') {
    const { type, id, date, offered_ids, picked_ids, completed_ids, status, task_snapshots } = req.body;
    const snapJson = JSON.stringify(task_snapshots || []);

    if (type === 'draft') {
      await sql`
        INSERT INTO daily_sessions_v2
          (id, user_id, date, offered_ids, picked_ids, completed_ids, status, task_snapshots)
        VALUES
          (${id}, ${userId}, ${date}, ${offered_ids}, ${picked_ids || []}, ${completed_ids || []}, 'draft', ${snapJson}::jsonb)
        ON CONFLICT (user_id, date) DO UPDATE SET
          id          = EXCLUDED.id,
          offered_ids = EXCLUDED.offered_ids,
          status      = 'draft'
        WHERE daily_sessions_v2.status NOT IN ('active', 'done')
      `;
    } else {
      await sql`
        INSERT INTO daily_sessions_v2
          (id, user_id, date, offered_ids, picked_ids, completed_ids, status, task_snapshots)
        VALUES
          (${id}, ${userId}, ${date}, ${offered_ids}, ${picked_ids}, ${completed_ids}, ${status}, ${snapJson}::jsonb)
        ON CONFLICT (user_id, date) DO UPDATE SET
          id             = EXCLUDED.id,
          offered_ids    = EXCLUDED.offered_ids,
          picked_ids     = EXCLUDED.picked_ids,
          completed_ids  = EXCLUDED.completed_ids,
          status         = EXCLUDED.status,
          task_snapshots = EXCLUDED.task_snapshots
      `;
    }
    return res.json({ ok: true });
  }

  // PATCH — update fields on an existing session
  if (req.method === 'PATCH') {
    const { id, completed_ids, status } = req.body;
    if (completed_ids !== undefined && status !== undefined) {
      await sql`
        UPDATE daily_sessions_v2
        SET completed_ids = ${completed_ids}, status = ${status}
        WHERE id = ${id} AND user_id = ${userId}
      `;
    } else if (completed_ids !== undefined) {
      await sql`
        UPDATE daily_sessions_v2
        SET completed_ids = ${completed_ids}
        WHERE id = ${id} AND user_id = ${userId}
      `;
    } else if (status !== undefined) {
      await sql`
        UPDATE daily_sessions_v2
        SET status = ${status}
        WHERE id = ${id} AND user_id = ${userId}
      `;
    }
    return res.json({ ok: true });
  }

  // DELETE — ?id=xxx deletes one session; no id deletes all for user
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (id) {
      await sql`DELETE FROM daily_sessions_v2 WHERE id = ${id} AND user_id = ${userId}`;
    } else {
      await sql`DELETE FROM daily_sessions_v2 WHERE user_id = ${userId}`;
    }
    return res.json({ ok: true });
  }

  res.status(405).end();
});
