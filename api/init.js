const { sql } = require('./_db');
const { withAuth } = require('./_auth');

const DEFAULT_TASKS = [
  { id: 'c1',  type: 'common',    title: 'Morning Walk',      description: 'Take a 20-minute walk outside' },
  { id: 'c2',  type: 'common',    title: 'Hydrate',           description: 'Drink 8 glasses of water' },
  { id: 'c3',  type: 'common',    title: 'Read',              description: 'Read for at least 20 minutes' },
  { id: 'c4',  type: 'common',    title: 'Meditate',          description: '10 minutes of mindfulness' },
  { id: 'c5',  type: 'common',    title: 'Journal',           description: 'Write 5 minutes in your journal' },
  { id: 'c6',  type: 'common',    title: 'No Social Media',   description: 'Avoid social media until noon' },
  { id: 'c7',  type: 'common',    title: 'Exercise',          description: 'Work out for 30 minutes' },
  { id: 'c8',  type: 'common',    title: 'Healthy Breakfast', description: 'Eat a nutritious breakfast' },
  { id: 'c9',  type: 'common',    title: 'Connect',           description: 'Reach out to someone you care about' },
  { id: 'c10', type: 'common',    title: 'Early Bed',         description: 'In bed before midnight' },
  { id: 'l1',  type: 'legendary', title: 'The Fast',          description: 'Complete a 16-hour fast' },
  { id: 'l2',  type: 'legendary', title: 'Ice Bath',          description: 'Take a cold shower or ice bath' },
  { id: 'l3',  type: 'legendary', title: 'Deep Work',         description: '3 hours of uninterrupted focused work' },
];

module.exports = withAuth(async (req, res, userId) => {
  if (req.method !== 'GET') return res.status(405).end();

  // Create tables (idempotent — safe to run on every init)
  await sql`
    CREATE TABLE IF NOT EXISTS daily_sessions_v2 (
      id          text NOT NULL,
      user_id     text NOT NULL,
      date        text NOT NULL,
      offered_ids text[] NOT NULL DEFAULT '{}',
      picked_ids  text[] NOT NULL DEFAULT '{}',
      completed_ids text[] NOT NULL DEFAULT '{}',
      status      text NOT NULL DEFAULT 'picking',
      task_snapshots jsonb DEFAULT '[]',
      created_at  timestamptz DEFAULT now(),
      PRIMARY KEY (user_id, id),
      UNIQUE (user_id, date)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tasks_v2 (
      id          text NOT NULL,
      user_id     text NOT NULL,
      title       text NOT NULL,
      description text,
      type        text NOT NULL,
      archived    boolean NOT NULL DEFAULT false,
      created_at  timestamptz DEFAULT now(),
      PRIMARY KEY (user_id, id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS wallet_v2 (
      user_id                   text PRIMARY KEY,
      common                    int NOT NULL DEFAULT 0,
      legendary                 int NOT NULL DEFAULT 0,
      mythic                    int NOT NULL DEFAULT 0,
      last_purchase_date        text,
      last_purchase_item_name   text,
      last_purchase_item_rarity text
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS settings_v2 (
      user_id    text PRIMARY KEY,
      reset_hour int NOT NULL DEFAULT 8
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS store_items_v2 (
      id          text NOT NULL,
      user_id     text NOT NULL,
      name        text NOT NULL,
      description text,
      cost        int NOT NULL DEFAULT 1,
      rarity      text NOT NULL DEFAULT 'common',
      PRIMARY KEY (user_id, id)
    )
  `;

  // Fetch all user data in parallel
  const [sessionRows, taskRows, walletRows, settingsRows, storeRows] = await Promise.all([
    sql`SELECT * FROM daily_sessions_v2 WHERE user_id = ${userId} ORDER BY date DESC`,
    sql`SELECT * FROM tasks_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM wallet_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM settings_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM store_items_v2 WHERE user_id = ${userId}`,
  ]);

  // Seed default tasks for new users
  if (taskRows.length === 0) {
    for (const t of DEFAULT_TASKS) {
      await sql`
        INSERT INTO tasks_v2 (id, user_id, title, description, type, archived)
        VALUES (${t.id}, ${userId}, ${t.title}, ${t.description}, ${t.type}, false)
        ON CONFLICT (user_id, id) DO NOTHING
      `;
    }
    const seeded = await sql`SELECT * FROM tasks_v2 WHERE user_id = ${userId}`;
    taskRows.push(...seeded);
  }

  res.json({
    sessions:   sessionRows,
    tasks:      taskRows,
    wallet:     walletRows[0] || null,
    settings:   settingsRows[0] || null,
    storeItems: storeRows.map(r => ({
      id: r.id, name: r.name, desc: r.description, cost: r.cost, rarity: r.rarity,
    })),
  });
});
