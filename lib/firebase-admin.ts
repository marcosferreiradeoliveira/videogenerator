import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';

// FIREBASE_* é reservado no Firebase App Hosting — em produção use SERVICE_ACCOUNT_* (mesmos valores).
// NEXT_PUBLIC_FIREBASE_PROJECT_ID costuma ser igual ao projectId da conta de serviço (fallback útil no App Hosting).
const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID ||
  process.env.SERVICE_ACCOUNT_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail =
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.SERVICE_ACCOUNT_CLIENT_EMAIL;
const privateKey = (
  process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.SERVICE_ACCOUNT_PRIVATE_KEY
)?.replace(/\\n/g, '\n');
const storageBucket =
  process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
  process.env.SERVICE_ACCOUNT_STORAGE_BUCKET ||
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

const isFirebaseAdminConfigured = Boolean(projectId && clientEmail && privateKey);

const adminApp = isFirebaseAdminConfigured
  ? getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        storageBucket: storageBucket || undefined,
      })
  : null;

export const adminAuth = adminApp ? getAuth(adminApp) : null;
export const adminDb = adminApp ? getFirestore(adminApp) : null;
export const adminStorage = adminApp ? getStorage(adminApp) : null;
export const isAdminConfigured = isFirebaseAdminConfigured;

/** Nome do bucket GCS usado por rotas que gravam arquivos (audio, etc.). */
export function getResolvedStorageBucketName(): string | null {
  if (!projectId) return null;
  const explicit =
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET?.trim() ||
    process.env.SERVICE_ACCOUNT_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;
  return `${projectId}.appspot.com`;
}

export function getAdminStorageBucket(): Bucket | null {
  if (!adminStorage) return null;
  const name = getResolvedStorageBucketName();
  if (!name) return null;
  return adminStorage.bucket(name);
}

/** Mensagem em portugues para falhas comuns ao salvar no Storage (upload / TTS). */
export function describeStorageFailure(error: unknown, bucketName: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('404') ||
    lower.includes('no such bucket')
  ) {
    return `O bucket "${bucketName}" nao existe ou o Storage nao foi ativado. No Firebase Console: Build > Storage > "Comecar" / Get started. Depois confira se NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET e FIREBASE_ADMIN_STORAGE_BUCKET batem com o nome do bucket (ex. projeto.appspot.com ou projeto.firebasestorage.app).`;
  }
  if (
    lower.includes('permission') ||
    lower.includes('403') ||
    lower.includes('forbidden') ||
    lower.includes('access denied')
  ) {
    const who = clientEmail ? ` (${clientEmail})` : '';
    return `Permissao negada no Storage no bucket "${bucketName}". Na Google Cloud Console > IAM, a conta de servico do Admin${who} precisa de papel como "Storage Object Admin" ou "Firebase Admin SDK Administrator Service Agent" no projeto.`;
  }
  if (lower.includes('billing') || lower.includes('account disabled')) {
    return 'Projeto Google Cloud: verifique se a faturamento esta ativo e o projeto nao esta suspenso.';
  }
  return `Firebase Storage: ${raw}`;
}
