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
    // Query by code only; match the phone ourselves (Dexatel may store the
    // number in a different format than the "+374…" we send).
    const url =
      'https://api.dexatel.com/v1/verifications?code=' + encodeURIComponent(otp);

    const r = await fetch(url, {
      method: 'GET',
      headers: { 'X-Dexatel-Key': apiKey },
    });

    const rawText = await r.text().catch(() => '');
    if (!r.ok) {
      console.error('[verify-otp] Dexatel error', r.status, rawText); // server-side only
      const b = { valid: false };
      if (req.query && req.query.debug === '1') { b._status = r.status; b._raw = rawText; } // TEMP
      return res.status(200).json(b);
    }

    let json = {};
    try { json = JSON.parse(rawText); } catch (e) {}
    const list = Array.isArray(json.data) ? json.data : [];
    const now = Date.now();
    const wantDigits = fullPhone.replace(/\D/g, ''); // e.g. 37499557400

    // Valid = a record whose phone matches (compared as digits only, allowing
    // for +374 / 374 / local forms) and that hasn't expired.
    const valid = list.some((v) => {
      if (!v) return false;
      const got = String(v.phone || '').replace(/\D/g, '');
      const phoneMatch =
        got === wantDigits || got.endsWith(local) || wantDigits.endsWith(got);
      const notExpired =
        !v.expire_date || new Date(v.expire_date).getTime() > now;
      return phoneMatch && notExpired;
    });

    const b = { valid };
    if (req.query && req.query.debug === '1') { b._raw = rawText; b._fullPhone = fullPhone; b._count = list.length; } // TEMP
    return res.status(200).json(b);
  } catch (err) {
    console.error('[verify-otp] Request failed', err); // server-side only
    return res.status(200).json({ valid: false });
  }
};
