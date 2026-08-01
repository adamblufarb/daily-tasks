const { sql } = require('./_db');
const { verifyToken, createClerkClient } = require('@clerk/backend');

const ADMIN_EMAIL = 'adam.blufarb@gmail.com';

function daysBetween(dateStrA, dateStrB) {
  const [ay, am, ad] = dateStrA.split('-').map(Number);
  const [by, bm, bd] = dateStrB.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

async function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(auth.slice(7), { secretKey: process.env.CLERK_SECRET_KEY });
    return payload.sub;
  } catch { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const clerkAdmin = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const requestingUser = await clerkAdmin.users.getUser(userId).catch(() => null);
  const email = requestingUser?.emailAddresses?.[0]?.emailAddress;
  if (email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

  const [sessions, wallets, settings, editedActRows, profiles] = await Promise.all([
    sql`SELECT * FROM daily_sessions_v2 ORDER BY user_id, date ASC`,
    sql`SELECT * FROM wallet_v2`,
    sql`SELECT * FROM settings_v2`,
    sql`
      SELECT id, title, type, SUM(edit_count) AS total_edits
      FROM tasks_v2
      WHERE edit_count > 0
      GROUP BY id, title, type
      ORDER BY total_edits DESC
    `,
    sql`SELECT user_id, ftue_answers FROM profiles_v2`,
  ]);

  const allUserIds = [...new Set([
    ...sessions.map(r => r.user_id),
    ...wallets.map(r => r.user_id),
    ...settings.map(r => r.user_id),
  ])];

  const clerkUserMap = {};
  await Promise.all(allUserIds.map(async id => {
    const u = await clerkAdmin.users.getUser(id).catch(() => null);
    clerkUserMap[id] = u?.emailAddresses?.[0]?.emailAddress || id;
  }));

  const walletMap   = Object.fromEntries(wallets.map(w  => [w.user_id,  w]));
  const settingsMap = Object.fromEntries(settings.map(s  => [s.user_id,  s]));
  const profileMap  = Object.fromEntries(profiles.map(p  => [p.user_id,  p]));

  const sessionsByUser = {};
  for (const sess of sessions) {
    if (!sessionsByUser[sess.user_id]) sessionsByUser[sess.user_id] = [];
    sessionsByUser[sess.user_id].push(sess);
  }

  const users = allUserIds.map(uid => {
    const userSessions = sessionsByUser[uid] || [];
    const wallet  = walletMap[uid]  || {};
    const setting = settingsMap[uid] || {};
    const profile = profileMap[uid]  || {};

    const total = userSessions.filter(s => s.status === 'done').length;
    const honored = userSessions.filter(s =>
      s.status === 'done' &&
      s.picked_ids?.length > 0 &&
      s.completed_ids?.length === s.picked_ids?.length
    ).length;
    const completionRate = total > 0 ? Math.round((honored / total) * 100) : 0;
    const lastActive = userSessions.reduce((max, s) => s.date > max ? s.date : max, '');

    // Streaks require genuinely consecutive calendar dates — a Ritual is
    // Honored with >=1 act completed, and any gap (a missed day, or a
    // failed day with 0 completed) breaks the run back to 0/1.
    const doneSessions = userSessions
      .filter(s => s.status === 'done' && s.picked_ids?.length > 0)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    let longestStreak = 0, currentRunStreak = 0, prevDate = null;
    for (const sess of doneSessions) {
      const isHonored = sess.completed_ids?.length >= 1;
      if (!isHonored) {
        currentRunStreak = 0;
      } else if (prevDate && daysBetween(sess.date, prevDate) === 1) {
        currentRunStreak++;
      } else {
        currentRunStreak = 1;
      }
      longestStreak = Math.max(longestStreak, currentRunStreak);
      prevDate = sess.date;
    }

    const actStats = {};
    for (const sess of userSessions) {
      const snapMap = {};
      for (const snap of (sess.task_snapshots || [])) snapMap[snap.id] = snap;
      for (const id of (sess.picked_ids || [])) {
        const task = snapMap[id];
        const key = task?.title || id;
        if (!actStats[key]) actStats[key] = { title: key, type: task?.type || 'common', assigned: 0, completed: 0 };
        actStats[key].assigned++;
        if ((sess.completed_ids || []).includes(id)) actStats[key].completed++;
      }
    }

    let earnedCommon = 0, earnedLegendary = 0, earnedMythic = 0;
    for (const sess of userSessions) {
      const isHonored = sess.status === 'done' && sess.picked_ids?.length > 0 && sess.completed_ids?.length === sess.picked_ids?.length;
      if (!isHonored) continue;
      const snapMap = {};
      for (const snap of (sess.task_snapshots || [])) snapMap[snap.id] = snap;
      for (const id of (sess.completed_ids || [])) {
        if (snapMap[id]?.type === 'legendary') earnedLegendary++;
        else earnedCommon++;
      }
      if (sess.picked_ids?.length === 5) earnedMythic++;
    }

    const ritualCount = setting.onboarding_ritual_count || 0;
    const hasCompleted = setting.has_completed_onboarding || false;
    let onboardingStage = 'New User';
    if (hasCompleted) onboardingStage = 'Completed';
    else if (ritualCount >= 2) onboardingStage = 'Bazaar Tutorial';
    else if (ritualCount >= 1) onboardingStage = 'Record Tutorial';

    return {
      userId: uid,
      email: clerkUserMap[uid] || uid,
      total,
      honored,
      completionRate,
      lastActive: lastActive || null,
      longestStreak,
      currentStreak: currentRunStreak,
      actStats: Object.values(actStats).sort((a, b) => b.assigned - a.assigned),
      tokensEarned: { common: earnedCommon, legendary: earnedLegendary, mythic: earnedMythic },
      walletBalance: { common: wallet.common || 0, legendary: wallet.legendary || 0, mythic: wallet.mythic || 0 },
      tokensSpent: {
        common: Math.max(0, earnedCommon - (wallet.common || 0)),
        legendary: Math.max(0, earnedLegendary - (wallet.legendary || 0)),
        mythic: Math.max(0, earnedMythic - (wallet.mythic || 0)),
      },
      onboardingStage,
      ftueAnswers: profile.ftue_answers || null,
    };
  });

  // Aggregate act popularity across all users
  const globalActMap = {};
  for (const user of users) {
    for (const act of user.actStats) {
      const key = act.title;
      if (!globalActMap[key]) globalActMap[key] = { title: act.title, type: act.type, selected: 0, completed: 0 };
      globalActMap[key].selected += act.assigned;
      globalActMap[key].completed += act.completed;
    }
  }
  const globalActStats = Object.values(globalActMap).sort((a, b) => b.selected - a.selected);

  const editedActs = editedActRows.map(r => ({
    title: r.title,
    type: r.type,
    totalEdits: Number(r.total_edits),
  }));

  res.json({ users, globalActStats, editedActs, generatedAt: new Date().toISOString() });
};
