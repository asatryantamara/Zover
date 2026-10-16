// Daily cron ping that keeps the Supabase project from auto-pausing.
// Free-tier Supabase pauses after ~7 days with no activity; one lightweight
// query a day resets that clock. Uses the PUBLIC publishable key (the same one
// already shipped in the browser) — no secrets involved.
module.exports = async function handler(req, res) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://rerzixogkyyuxqtuanll.supabase.co';
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_rkiJ0D60evhyl27cZgwpEQ_u29uS5LG';

  try {
    const r = await fetch(url + '/rest/v1/partners?select=id&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    console.log('[keep-alive] supabase ping status', r.status);
    return res.status(200).json({ ok: r.ok, status: r.status, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[keep-alive] failed', err);
    return res.status(200).json({ ok: false, ts: new Date().toISOString() });
  }
};
