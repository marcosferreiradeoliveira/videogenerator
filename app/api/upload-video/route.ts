import { NextResponse } from 'next/server';
import {
  adminAuth,
  adminDb,
  describeStorageFailure,
  getAdminStorageBucket,
  getResolvedStorageBucketName,
  isAdminConfigured,
} from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const MAX_BYTES = 120 * 1024 * 1024;

const MIME_TO_EXT: Record<string, { ext: string; contentType: string }> = {
  'video/mp4': { ext: 'mp4', contentType: 'video/mp4' },
  'video/webm': { ext: 'webm', contentType: 'video/webm' },
  'video/quicktime': { ext: 'mov', contentType: 'video/quicktime' },
  'video/x-matroska': { ext: 'mkv', contentType: 'video/x-matroska' },
};

function resolveVideoFile(file: File) {
  const type = (file.type || '').toLowerCase().split(';')[0].trim();
  const mapped = MIME_TO_EXT[type];
  if (mapped) return mapped;
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp4')) return MIME_TO_EXT['video/mp4'];
  if (name.endsWith('.webm')) return MIME_TO_EXT['video/webm'];
  if (name.endsWith('.mov')) return MIME_TO_EXT['video/quicktime'];
  if (name.endsWith('.mkv')) return MIME_TO_EXT['video/x-matroska'];
  return null;
}

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }
  const bucket = getAdminStorageBucket();
  const bucketName = getResolvedStorageBucketName();
  if (!bucket || !bucketName) {
    return NextResponse.json({ error: 'Firebase Storage nao configurado.' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const projectId = String(formData.get('projectId') ?? '').trim();
    const idToken = String(formData.get('idToken') ?? '').trim();
    const raw = formData.get('file');

    if (!projectId || !idToken) {
      return NextResponse.json({ error: 'projectId e idToken sao obrigatorios.' }, { status: 400 });
    }
    if (!(raw instanceof File) || raw.size === 0) {
      return NextResponse.json({ error: 'Envie um arquivo de video valido.' }, { status: 400 });
    }
    if (raw.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Video muito grande (max ${Math.round(MAX_BYTES / (1024 * 1024))} MB).` },
        { status: 400 }
      );
    }

    const resolved = resolveVideoFile(raw);
    if (!resolved) {
      return NextResponse.json({ error: 'Formato nao suportado. Use MP4, WebM, MOV ou MKV.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const buffer = Buffer.from(await raw.arrayBuffer());
    const filePath = `users/${uid}/translations/${projectId}/source.${resolved.ext}`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      resumable: false,
      contentType: resolved.contentType,
      public: false,
      metadata: { cacheControl: 'public,max-age=3600' },
    });
    const [sourceVideoUrl] = await file.getSignedUrl({ action: 'read', expires: '2100-01-01' });

    const now = new Date().toISOString();
    await adminDb.collection('users').doc(uid).collection('translations').doc(projectId).set(
      {
        id: projectId,
        date: now,
        status: 'idle',
        sourceVideoUrl,
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ sourceVideoUrl });
  } catch (error) {
    console.error('upload-video', error);
    const name = getResolvedStorageBucketName() || '(bucket desconhecido)';
    return NextResponse.json(
      { error: describeStorageFailure(error, name) },
      { status: 500 }
    );
  }
}
