// POST { phone }  ->  { ok: true } | { ok: false, error }
// Sends an Armenian (+374) SMS verification code via the Dexatel Verify API.
// Secrets come from env only; Dexatel's raw errors are logged, never returned.

// Best-effort in-memory rate limit: 5 sends / phone / hour.
// NOTE: per-instance only (serverless). For hard global limits use Vercel KV / Upstash.
const RATE = new Map(); // fullPhone -> [timestamps]
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function isRateLimited(key) {
  const now = Date.now();
  const hits = (RATE.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    RATE.set(key, hits);
    return true;
  }
  hits.push(now);
  RATE.set(key, hits);
  return false;
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  return b && typeof b === 'object' ? b : {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { phone } = readBody(req);
  const local = (phone == null ? '' : String(phone)).trim();

  // Validate BEFORE calling Dexatel: exactly 8 digits.
  if (!/^\d{8}$/.test(local)) {
    return res.status(400).json({ ok: false, error: 'Invalid phone number' });
  }
  const fullPhone = '+374' + local;

  if (isRateLimited(fullPhone)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' });
  }

  const apiKey = process.env.DEXATEL_API_KEY;
  const sender = process.env.DEXATEL_SENDER;
  if (!apiKey || !sender) {
    console.error('[send-otp] Missing DEXATEL_API_KEY or DEXATEL_SENDER env var');
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const data = { channel: 'SMS', sender, phone: fullPhone, code_length: 6 };
  if (process.env.DEXATEL_TEMPLATE) data.template = process.env.DEXATEL_TEMPLATE;

  try {
    const r = await fetch('https://api.dexatel.com/v1/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dexatel-Key': apiKey },
      body: JSON.stringify({ data }),
    });

    if (!r.ok) {
      const raw = await r.text().catch(() => '');
      console.error('[send-otp] Dexatel error', r.status, raw); // server-side only
      return res.status(502).json({ ok: false, error: 'Could not send code' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[send-otp] Request failed', err); // server-side only
    return res.status(502).json({ ok: false, error: 'Could not send code' });
  }
};
