/**
 * Vérifier la fonction Vercel construite (`npx nx run api:vercel-build`) avant de la déployer : elle
 * est copiée hors du dépôt (sans quoi Node trouverait dans `node_modules` du dépôt ce que le traçage
 * aurait oublié), chargée comme Vercel la charge (`handler` de `.vc-config.json`, appelé avec
 * `req`/`res` de Node), puis interrogée sur quelques routes.
 *
 * Aucun service réel : configuration factice (plus les variables que la fonction reçoit de son
 * `.vc-config.json`), Firestore sur un émulateur absent que ces routes ne touchent pas. Ce test
 * vérifie que la fonction démarre et route, pas Supabase, Gemini ni Firestore.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const built = path.join(root, '.vercel/output/functions/api.func');
const origin = 'https://app.example.com';

Object.assign(process.env, {
  NODE_ENV: 'production',
  CORS_ORIGINS: origin,
  TRUST_PROXY: 'true',
  LOG_FORMAT: 'json',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'smoke-test',
  SUPABASE_SECRET_KEY: 'smoke-test',
  GEMINI_API_KEY: 'smoke-test',
  WORKFLOW_STATE_STORE: 'firestore',
  FIREBASE_PROJECT_ID: 'smoke-test',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
});

const isolated = await mkdtemp(path.join(tmpdir(), 'apex-brain-function-'));
const checks = [];

try {
  await cp(built, isolated, { recursive: true });
  const config = JSON.parse(await readFile(path.join(isolated, '.vc-config.json'), 'utf8'));
  Object.assign(process.env, config.environment);
  const { default: handle } = await import(pathToFileURL(path.join(isolated, config.handler)).href);

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const check = async (name, run) => {
    await run();
    checks.push(name);
  };

  try {
    await check('GET /health', async () => {
      const response = await fetch(`${base}/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'ok');
    });

    await check('route protégée sans jeton : 401', async () => {
      const response = await fetch(`${base}/v2/bff/objective-tree`);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    });

    await check('corps JSON lu par Express : 400 VALIDATION_ERROR', async () => {
      const response = await fetch(`${base}/v2/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'pas-un-email' }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    });

    await check('pré-vol CORS depuis une origine autorisée', async () => {
      const response = await fetch(`${base}/v2/auth/me`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    });

    await check('OpenAPI (métadonnées des décorateurs comprises)', async () => {
      const document = await (await fetch(`${base}/docs-json`)).json();
      assert.ok(document.paths['/v2/auth/login']?.post?.requestBody, 'corps de /v2/auth/login absent');
    });

    await check('Swagger UI et ses fichiers', async () => {
      const page = await fetch(`${base}/docs`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      const script = await fetch(`${base}/docs/swagger-ui-bundle.js`);
      assert.equal(script.status, 200);
    });

    await check('v1 retirée : 404', async () => {
      assert.equal((await fetch(`${base}/v1/objectives`)).status, 404);
    });
  } finally {
    server.close();
  }

  console.log(
    `Fonction Vercel vérifiée (${checks.length} contrôles) :\n${checks.map((name) => `  ✓ ${name}`).join('\n')}`,
  );
} finally {
  await rm(isolated, { recursive: true, force: true });
}

// L'application garde des minuteries (éviction des acteurs, limitation de débit) : on sort.
process.exit(0);
