const { sql } = require('./_db');
const { withAuth } = require('./_auth');

const DEFAULT_STORE_ITEMS = [
  { id: 'o1', name: 'Guilt Free Treat', cost: 5,  rarity: 'mythic', description: 'Indulge with a treat you wouldn\'t normally eat' },
  { id: 'o2', name: 'Purge',            cost: 15, rarity: 'mythic', description: 'Have a day for yourself, no consequences'          },
];

const DEFAULT_TASKS = [
  { id: 'c1',  type: 'common',    title: 'Long Walk',              description: 'Take a 45 minute walk outside' },
  { id: 'c2',  type: 'common',    title: 'Hydrate',                description: 'Drink 8 glasses of water' },
  { id: 'c3',  type: 'common',    title: 'Read',                   description: 'Read for at least 15 minutes' },
  { id: 'c4',  type: 'common',    title: 'Light Phone Detox',      description: "Don't use your phone after 21:30" },
  { id: 'c5',  type: 'common',    title: 'Social Media Breather',  description: 'Avoid social media until noon' },
  { id: 'c6',  type: 'common',    title: 'Exercise',               description: 'Work out for 30 minutes' },
  { id: 'c7',  type: 'common',    title: 'Connect',                description: 'Reach out to someone you care about' },
  { id: 'c8',  type: 'common',    title: 'Early Bed',              description: 'Get in bed before 22:30' },
  { id: 'c9',  type: 'common',    title: 'Little Chef',            description: 'Cook something' },
  { id: 'c10', type: 'common',    title: 'Stretch',                description: '10 minutes of stretching' },
  { id: 'c11', type: 'common',    title: 'Cold Shower',            description: 'Take a cold shower today' },
  { id: 'c12', type: 'common',    title: 'No Sweets',              description: 'Avoid sugar and sweets for the day' },
  { id: 'l1',  type: 'legendary', title: 'Social Media Ban',       description: 'Avoid social media all day' },
  { id: 'l2',  type: 'legendary', title: 'Heavy Phone Detox',      description: "Don't use your phone after 18:00" },
  { id: 'l3',  type: 'legendary', title: 'Schedule Dinner',        description: 'Schedule dinner with friends' },
  { id: 'l4',  type: 'legendary', title: 'Big Chef',               description: 'Cook something new' },
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
      user_id                    text PRIMARY KEY,
      reset_hour                 int NOT NULL DEFAULT 8,
      has_completed_onboarding   boolean NOT NULL DEFAULT false,
      onboarding_ritual_count    int NOT NULL DEFAULT 0
    )
  `;
  await sql`ALTER TABLE settings_v2 ADD COLUMN IF NOT EXISTS has_completed_onboarding boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE settings_v2 ADD COLUMN IF NOT EXISTS onboarding_ritual_count int NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE settings_v2 ADD COLUMN IF NOT EXISTS has_shown_record_tutorial boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE settings_v2 ADD COLUMN IF NOT EXISTS has_shown_bazaar_tutorial boolean NOT NULL DEFAULT false`;
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

  // Remove old placeholder offerings (idempotent)
  await sql`
    DELETE FROM store_items_v2
    WHERE user_id = ${userId}
      AND id IN ('s1','s2','s3')
      AND name IN ('Rest Day Pass','Bonus Legendary','Mythic Boost','Mythical Boost')
  `;

  // Fetch all user data in parallel
  const [sessionRows, taskRows, walletRows, settingsRows, storeRows] = await Promise.all([
    sql`SELECT * FROM daily_sessions_v2 WHERE user_id = ${userId} ORDER BY date DESC`,
    sql`SELECT * FROM tasks_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM wallet_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM settings_v2 WHERE user_id = ${userId}`,
    sql`SELECT * FROM store_items_v2 WHERE user_id = ${userId}`,
  ]);

  // Seed default offerings for new users
  if (storeRows.length === 0) {
    for (const item of DEFAULT_STORE_ITEMS) {
      await sql`
        INSERT INTO store_items_v2 (id, user_id, name, description, cost, rarity)
        VALUES (${item.id}, ${userId}, ${item.name}, ${item.description}, ${item.cost}, ${item.rarity})
        ON CONFLICT (user_id, id) DO NOTHING
      `;
    }
    const seeded = await sql`SELECT * FROM store_items_v2 WHERE user_id = ${userId}`;
    storeRows.push(...seeded);
  }

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
