#!/usr/bin/env node
/**
 * Gera blocos YAML `env:` a partir de .env.local para colar em apphosting.yaml.
 * O Firebase CLI não tem `apphosting:env:set`; variáveis públicas vão no ficheiro + deploy.
 *
 * Uso:
 *   node scripts/emit-apphosting-env.mjs
 *   node scripts/emit-apphosting-env.mjs /caminho/.env.local
 *
 * Copia a saída para a secção `env:` de apphosting.yaml (ou junta à lista existente) e corre npm run deploy:firebase.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'APP_URL',
  'SERVICE_ACCOUNT_PROJECT_ID',
  'SERVICE_ACCOUNT_CLIENT_EMAIL',
  'SERVICE_ACCOUNT_STORAGE_BUCKET',
];

function parseEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).replace(/\\n/g, '\n');
    }
    out[key] = val;
  }
  return out;
}

function yamlDoubleQuoted(s) {
  const escaped = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function emitEntry(variable, value) {
  if (value === undefined || value === '') return '';
  return `  - variable: ${variable}
    value: ${yamlDoubleQuoted(value)}
    availability:
      - BUILD
      - RUNTIME
`;
}

const envPath = process.argv[2] || path.join(root, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error(`Ficheiro não encontrado: ${envPath}`);
  process.exit(1);
}

const env = parseEnvFile(envPath);
if (!env.SERVICE_ACCOUNT_PROJECT_ID && env.FIREBASE_ADMIN_PROJECT_ID) {
  env.SERVICE_ACCOUNT_PROJECT_ID = env.FIREBASE_ADMIN_PROJECT_ID;
}
if (!env.SERVICE_ACCOUNT_CLIENT_EMAIL && env.FIREBASE_ADMIN_CLIENT_EMAIL) {
  env.SERVICE_ACCOUNT_CLIENT_EMAIL = env.FIREBASE_ADMIN_CLIENT_EMAIL;
}
if (!env.SERVICE_ACCOUNT_STORAGE_BUCKET && env.FIREBASE_ADMIN_STORAGE_BUCKET) {
  env.SERVICE_ACCOUNT_STORAGE_BUCKET = env.FIREBASE_ADMIN_STORAGE_BUCKET;
}
const chunks = [];
for (const k of KEYS) {
  const block = emitEntry(k, env[k]);
  if (block) chunks.push(block.trimEnd());
}

if (chunks.length === 0) {
  console.error('Nenhuma variável conhecida encontrada no ficheiro.');
  process.exit(1);
}

console.log('# --- Colar estas entradas na lista `env:` de apphosting.yaml (mesmo nível que - variable / secret existentes) ---');
chunks.forEach((c) => console.log(c));
