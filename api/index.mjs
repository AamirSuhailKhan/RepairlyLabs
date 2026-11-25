/**
 * Safety gate: Vercel serverless does not provide a persistent writable volume
 * for local SQLite files. When TURSO_DATABASE_URL is configured, RepairlyLabs
 * runs against persistent Turso Cloud SQLite over HTTPS; otherwise it fails
 * closed with 503 PERSISTENT_HOST_REQUIRED so no disposable /tmp data is created.
 */
let cloudHandler = null;

export default async function handler(req, res) {
  if (process.env.VERCEL) {
    if (!(process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL)) {
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
    if (!cloudHandler) {
      const { createCloudApp } = await import('./turso-api.mjs');
      cloudHandler = createCloudApp();
    }
    return cloudHandler(req, res);
  }
  const { handleRequest } = await import('../src/server.mjs');
  return handleRequest(req, res);
}
