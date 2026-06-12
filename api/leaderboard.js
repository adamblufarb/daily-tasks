const { sql } = require('./_db');
const { withAuth } = require('./_auth');
const { createClerkClient } = require('@clerk/backend');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  // Only include users who haven't opted out
  const profiles = await sql`SELECT * FROM profiles_v2 WHERE hide_from_leaderboard = false`;
  const includedIds = profiles.map(p => p.user_id);

  if (includedIds.length === 0) return res.json({ users: [] });

  const [sessions, wallets] = await Promise.all([
    sql`SELECT user_id, date, status, picked_ids, completed_ids, task_snapshots
        FROM daily_sessions_v2
        WHERE user_id = ANY(${includedIds})
        ORDER BY user_id, date ASC`,
    sql`SELECT user_id, streak FROM wallet_v2 WHERE user_id = ANY(${includedIds})`,
  ]);

  // Resolve Clerk imageUrl for each user
  const clerkAdmin = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const imageMap = {};
  await Promise.all(includedIds.map(async id => {
    const u = await clerkAdmin.users.getUser(id).catch(() => null);
    imageMap[id] = u?.imageUrl || null;
  }));

  const walletMap = Object.fromEntries(wallets.map(w => [w.user_id, w]));
  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));

  const sessionsByUser = {};
  for (const sess of sessions) {
    if (!sessionsByUser[sess.user_id]) sessionsByUser[sess.user_id] = [];
    sessionsByUser[sess.user_id].push(sess);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const users = includedIds.map(uid => {
    const userSessions = sessionsByUser[uid] || [];
    const wallet = walletMap[uid] || {};
    const profile = profileMap[uid] || {};

    // Longest all-time streak (replay session history)
    let longestStreak = 0, runStreak = 0;
    for (const sess of userSessions) {
      const honored = sess.status === 'done' && sess.picked_ids?.length > 0 &&
        sess.completed_ids?.length === sess.picked_ids?.length;
      if (honored) { runStreak++; longestStreak = Math.max(longestStreak, runStreak); }
      else if (sess.status === 'done') runStreak = 0;
    }

    let acts7d = 0, actsAllTime = 0, mythicEarned = 0;
    for (const sess of userSessions) {
      const honored = sess.status === 'done' && sess.picked_ids?.length > 0 &&
        sess.completed_ids?.length === sess.picked_ids?.length;
      if (!honored) continue;

      const snapMap = {};
      for (const snap of (sess.task_snapshots || [])) snapMap[snap.id] = snap;

      let sessPoints = 0;
      for (const id of (sess.completed_ids || [])) {
        const pts = snapMap[id]?.type === 'legendary' ? 3 : 1;
        sessPoints += pts;
        actsAllTime += pts;
      }
      if (sess.date >= cutoff) acts7d += sessPoints;
      if (sess.picked_ids?.length === 5) mythicEarned++;
    }

    return {
      nickname: profile.nickname || 'Unknown',
      avatarUrl: imageMap[uid] || null,
      currentStreak: wallet.streak || 0,
      longestStreak,
      acts7d,
      actsAllTime,
      mythicEarned,
    };
  });

  res.json({ users });
});
