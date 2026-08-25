// POST { phone, code }  ->  { valid: true } | { valid: false }
// Asks Dexatel whether the code matches a live verification for this +374 number.
// Secrets come from env only; Dexatel's raw errors are logged, never returned.

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
    return res.status(405).json({ valid: false });
  }

  const { phone, code } = readBody(req);
  const local = (phone == null ? '' : String(phone)).trim();
  const otp = (code == null ? '' : String(code)).trim();

  // Validate BEFORE calling Dexatel.
  if (!/^\d{8}$/.test(local)) return res.status(400).json({ valid: false });
  if (!/^\d{4,8}$/.test(otp)) return res.status(400).json({ valid: false });
  const fullPhone = '+374' + local;

  const apiKey = process.env.DEXATEL_API_KEY;
  if (!apiKey) {
    console.error('[verify-otp] Missing DEXATEL_API_KEY env var');
    return res.status(500).json({ valid: false });
  }

  try {
    const url =
      'https://api.dexatel.com/v1/verifications?code=' +
      encodeURIComponent(otp) +
      '&phone=' +
      encodeURIComponent(fullPhone);

    const r = await fetch(url, {
      method: 'GET',
      headers: { 'X-Dexatel-Key': apiKey },
    });

    if (!r.ok) {
      const raw = await r.text().catch(() => '');
      console.error('[verify-otp] Dexatel error', r.status, raw); // server-side only
      return res.status(200).json({ valid: false });
    }

    const json = await r.json().catch(() => ({}));
    const list = Array.isArray(json.data) ? json.data : [];
    const now = Date.now();

    // Valid = a record for this exact phone that hasn't expired.
    const valid = list.some(
      (v) =>
        v &&
        v.phone === fullPhone &&
        (!v.expire_date || new Date(v.expire_date).getTime() > now)
    );

    return res.status(200).json({ valid });
  } catch (err) {
    console.error('[verify-otp] Request failed', err); // server-side only
    return res.status(200).json({ valid: false });
  }
};
