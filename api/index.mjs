/**
 * Safety gate: Vercel serverless does not provide a persistent writable volume
 * for this SQLite-backed, stateful application. Deploy the full app on a
 * persistent Node.js host (see docs/DEPLOYMENT.md).
 *
 * Do not import src/server.mjs on Vercel: that module initializes SQLite and
 * would otherwise create disposable owner accounts/orders under /tmp/data.
 */
export default async function handler(req, res) {
  if (process.env.VERCEL) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.end(JSON.stringify({
      ok: false,
      code: 'PERSISTENT_HOST_REQUIRED',
      error: 'RepairlyLabs requires a persistent Node.js server and database volume. Serverless /tmp storage is not supported. See docs/DEPLOYMENT.md.'
    }));
    return;
  }
  const { handleRequest } = await import('../src/server.mjs');
  return handleRequest(req, res);
}
