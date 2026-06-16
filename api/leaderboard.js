const { sql } = require('./_db');
const { withAuth } = require('./_auth');
const { createClerkClient } = require('@clerk/backend');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  // Fetch all activity sources + profiles in parallel
  const [sessionUserRows, wallets, profiles] = await Promise.all([
    sql`SELECT DISTINCT user_id FROM daily_sessions_v2`,
    sql`SELECT user_id, streak FROM wallet_v2`,
    sql`SELECT * FROM profiles_v2`,
  ]);

  // Build opt-out set — only users who explicitly hid themselves
  const optedOut = new Set(profiles.filter(p => p.hide_from_leaderboard).map(p => p.user_id));
  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));

  // All users with any activity, excluding opted-out
  const allIds = [...new Set([
    ...sessionUserRows.map(r => r.user_id),
    ...wallets.map(r => r.user_id),
  ])].filter(id => !optedOut.has(id));

  if (allIds.length === 0) return res.json({ users: [] });

  const [sessions, walletRows] = await Promise.all([
    sql`SELECT user_id, date, status, picked_ids, completed_ids, task_snapshots
        FROM daily_sessions_v2
        WHERE user_id = ANY(${allIds})
        ORDER BY user_id, date ASC`,
    sql`SELECT user_id, streak FROM wallet_v2 WHERE user_id = ANY(${allIds})`,
  ]);

  const walletMap = Object.fromEntries(walletRows.map(w => [w.user_id, w]));

  const sessionsByUser = {};
  for (const sess of sessions) {
    if (!sessionsByUser[sess.user_id]) sessionsByUser[sess.user_id] = [];
    sessionsByUser[sess.user_id].push(sess);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  // Inactivity filter — hide users who haven't started a Ritual (status
  // active/done; a 'draft' offer doesn't count) in 5+ consecutive days.
  function daysBetween(dateStrA, dateStrB) {
    const [ay, am, ad] = dateStrA.split('-').map(Number);
    const [by, bm, bd] = dateStrB.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
  }
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const activeIds = allIds.filter(uid => {
    const startedDates = (sessionsByUser[uid] || [])
      .filter(sess => sess.status === 'active' || sess.status === 'done')
      .map(sess => sess.date);
    if (startedDates.length === 0) return false;
    const lastStarted = startedDates.sort().at(-1);
    return daysBetween(todayDateStr, lastStarted) < 5;
  });

  if (activeIds.length === 0) return res.json({ users: [] });

  // Resolve Clerk imageUrl + nickname fallback — only for users who'll appear
  const clerkAdmin = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const clerkMap = {};
  await Promise.all(activeIds.map(async id => {
    const u = await clerkAdmin.users.getUser(id).catch(() => null);
    clerkMap[id] = {
      imageUrl: u?.imageUrl || null,
      displayName: u?.firstName || u?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'Unknown',
    };
  }));

  const users = activeIds.map(uid => {
    const userSessions = sessionsByUser[uid] || [];
    const wallet = walletMap[uid] || {};
    const profile = profileMap[uid];

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

    // Nickname: profile row wins, then Clerk name fallback
    const nickname = profile?.nickname || clerkMap[uid]?.displayName || 'Unknown';

    return {
      nickname,
      avatarUrl: clerkMap[uid]?.imageUrl || null,
      currentStreak: wallet.streak || 0,
      longestStreak,
      acts7d,
      actsAllTime,
      mythicEarned,
    };
  });

  res.json({ users });
});
