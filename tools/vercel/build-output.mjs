/**
 * Le déploiement Vercel d'Apex Brain au format Build Output API v3 (`.vercel/output`), construit à
 * partir du bundle de l'API (`npx nx build api`, lancé avant par `npm run vercel-build`) :
 *
 * - une seule fonction Node (`functions/api.func`), qui reçoit toutes les requêtes ;
 * - dedans, `dist/apps/api/` et les seuls fichiers de `node_modules` qu'il charge, trouvés par
 *   traçage (`@vercel/nft`, l'outil de Vercel), plus Swagger UI, que `/docs` sert sans l'importer ;
 * - aucun fichier statique : rien du dépôt n'est exposé, tout passe par l'API.
 *
 * Écrire la sortie nous-mêmes plutôt que laisser Vercel deviner (détection NestJS) : l'API est un
 * bundle Vite dans un monorepo Nx (alias `@org/*`, métadonnées de décorateurs émises par Oxc), que
 * la compilation de Vercel ne sait pas refaire. Voir ADR 0009.
 *
 * À la main : `npm run vercel-build`, puis `node tools/vercel/smoke-test.mjs`.
 */
import { nodeFileTrace } from '@vercel/nft';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = 'dist/apps/api';
const handler = `${bundle}/serverless.js`;
const output = path.join(root, '.vercel/output');
const functionDirectory = path.join(output, 'functions/api.func');

/** Lus à l'exécution par `express.static` (Swagger UI sur `/docs`) : invisibles au traçage. */
const untracedDirectories = ['node_modules/swagger-ui-dist'];

/** Limite de Vercel pour une fonction Node, décompressée. */
const MAX_FUNCTION_BYTES = 250 * 1024 * 1024;

/** 300 s, le maximum du plan Hobby : un tour d'Akari continue après la réponse (`waitUntil`). */
const MAX_DURATION_SECONDS = 300;

/**
 * Un tour d'Akari appartient à l'instance qui le mène tant qu'elle peut être en vie : la durée
 * maximale d'une invocation, plus une marge (horloges des instances). Passé ce délai sans
 * sauvegarde, il est abandonné et une autre instance le reprend (ADR 0009).
 */
const TURN_OWNERSHIP_SECONDS = MAX_DURATION_SECONDS + 30;

/**
 * La fonction (`.vc-config.json`) :
 * - Node 24, comme `.nvmrc` et la CI ;
 * - pas d'aides de Vercel sur `req`/`res` : Express lit lui-même le corps des requêtes ;
 * - une seule région, Francfort, celle de l'ancien service Render, près des données (Supabase,
 *   Firestore) : à changer ici si elles sont ailleurs ;
 * - `environment` s'ajoute aux variables du projet Vercel : ce qui tient à la fonction elle-même.
 */
const functionConfig = {
  runtime: 'nodejs24.x',
  handler,
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  shouldAddSourcemapSupport: true,
  supportsResponseStreaming: true,
  maxDuration: MAX_DURATION_SECONDS,
  regions: ['fra1'],
  environment: {
    ASSISTANT_TURN_OWNERSHIP_SECONDS: String(TURN_OWNERSHIP_SECONDS),
  },
};

/** Toutes les requêtes vont à la fonction, quel que soit le chemin (Express garde le chemin d'origine). */
const deploymentConfig = {
  version: 3,
  routes: [{ src: '/(.*)', dest: '/api' }],
};

async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}

if (!(await exists(path.join(root, handler)))) {
  throw new Error(`${handler} est introuvable : lancer d'abord \`npx nx build api\`.`);
}

await rm(output, { recursive: true, force: true });
await mkdir(functionDirectory, { recursive: true });

const { fileList, warnings } = await nodeFileTrace([path.join(root, handler)], { base: root });

// Bruit attendu : les dépendances facultatives de Nest (microservices, websockets,
// class-validator…), chargées dans un try/catch, et les fichiers non JavaScript que le traçage
// essaie de lire (licences des protos de gRPC). Le reste est montré.
const expectedWarning = /Cannot find module|Failed to parse/;
for (const warning of warnings) {
  const message = String(warning.message ?? warning);
  if (!expectedWarning.test(message)) console.warn(`nft : ${message}`);
}

const files = new Set([...fileList, 'package.json']);
for (const file of files) {
  await cp(path.join(root, file), path.join(functionDirectory, file), { recursive: true });
}

// Le bundle entier (cartes de source comprises, pour les piles d'erreur) et les fichiers non tracés.
for (const directory of [bundle, ...untracedDirectories]) {
  await cp(path.join(root, directory), path.join(functionDirectory, directory), { recursive: true });
}

await writeFile(
  path.join(functionDirectory, '.vc-config.json'),
  `${JSON.stringify(functionConfig, null, 2)}\n`,
);
await writeFile(path.join(output, 'config.json'), `${JSON.stringify(deploymentConfig, null, 2)}\n`);

const size = await directorySize(functionDirectory);
const megabytes = (size / 1024 / 1024).toFixed(1);

if (size > MAX_FUNCTION_BYTES) {
  throw new Error(`La fonction pèse ${megabytes} Mo, au-delà des 250 Mo acceptés par Vercel.`);
}

console.log(
  `.vercel/output prêt : une fonction (${handler}, ${files.size} fichiers tracés, ${megabytes} Mo), ` +
    `${functionConfig.runtime}, région ${functionConfig.regions.join(', ')}.`,
);
