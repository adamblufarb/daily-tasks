const { verifyToken } = require('@clerk/backend');

async function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(auth.slice(7), {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload.sub;
  } catch {
    return null;
  }
}

function withAuth(handler) {
  return async (req, res) => {
    const userId = await authenticate(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await handler(req, res, userId);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { withAuth };
