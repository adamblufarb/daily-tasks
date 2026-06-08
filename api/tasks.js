const { sql } = require('./_db');
const { withAuth } = require('./_auth');

module.exports = withAuth(async (req, res, userId) => {
  // POST — create or update a task (upsert by id)
  if (req.method === 'POST') {
    const { id, title, description, type } = req.body;
    await sql`
      INSERT INTO tasks_v2 (id, user_id, title, description, type, archived)
      VALUES (${id}, ${userId}, ${title}, ${description || ''}, ${type}, false)
      ON CONFLICT (user_id, id) DO UPDATE SET
        title       = EXCLUDED.title,
        description = EXCLUDED.description,
        type        = EXCLUDED.type
    `;
    return res.json({ ok: true });
  }

  // PATCH — update archived flag
  if (req.method === 'PATCH') {
    const { id, archived } = req.body;
    await sql`
      UPDATE tasks_v2 SET archived = ${archived}
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return res.json({ ok: true });
  }

  // DELETE — ?id=xxx
  if (req.method === 'DELETE') {
    const { id } = req.query;
    await sql`DELETE FROM tasks_v2 WHERE id = ${id} AND user_id = ${userId}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
});
