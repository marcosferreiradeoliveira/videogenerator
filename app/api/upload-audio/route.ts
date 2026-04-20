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

const MAX_BYTES = 40 * 1024 * 1024;

const MIME_TO_EXT: Record<string, { ext: string; contentType: string }> = {
  'audio/mpeg': { ext: 'mp3', contentType: 'audio/mpeg' },
  'audio/mp3': { ext: 'mp3', contentType: 'audio/mpeg' },
  'audio/wav': { ext: 'wav', contentType: 'audio/wav' },
  'audio/x-wav': { ext: 'wav', contentType: 'audio/wav' },
  'audio/mp4': { ext: 'm4a', contentType: 'audio/mp4' },
  'audio/x-m4a': { ext: 'm4a', contentType: 'audio/mp4' },
  'audio/webm': { ext: 'webm', contentType: 'audio/webm' },
  'audio/ogg': { ext: 'ogg', contentType: 'audio/ogg' },
};

function resolveAudioFile(file: File) {
  const type = (file.type || '').toLowerCase().split(';')[0].trim();
  const mapped = MIME_TO_EXT[type];
  if (mapped) return mapped;
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3')) return MIME_TO_EXT['audio/mpeg'];
  if (name.endsWith('.wav')) return MIME_TO_EXT['audio/wav'];
  if (name.endsWith('.m4a')) return MIME_TO_EXT['audio/mp4'];
  if (name.endsWith('.webm')) return MIME_TO_EXT['audio/webm'];
  if (name.endsWith('.ogg')) return MIME_TO_EXT['audio/ogg'];
  return null;
}

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }
  const bucket = getAdminStorageBucket();
  const bucketName = getResolvedStorageBucketName();
  if (!bucket || !bucketName) {
    return NextResponse.json(
      {
        error:
          'Firebase Storage nao pode ser inicializado. Defina FIREBASE_ADMIN_PROJECT_ID e o nome do bucket (FIREBASE_ADMIN_STORAGE_BUCKET ou NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).',
      },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const projectId = String(formData.get('projectId') ?? '').trim();
    const script = String(formData.get('script') ?? '').trim();
    const idToken = String(formData.get('idToken') ?? '').trim();
    const raw = formData.get('file');

    if (!projectId || !idToken) {
      return NextResponse.json({ error: 'projectId e idToken sao obrigatorios.' }, { status: 400 });
    }

    if (!(raw instanceof File) || raw.size === 0) {
      return NextResponse.json({ error: 'Envie um arquivo de audio valido.' }, { status: 400 });
    }

    if (raw.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Arquivo muito grande (max ${Math.round(MAX_BYTES / (1024 * 1024))} MB).` },
        { status: 400 }
      );
    }

    const resolved = resolveAudioFile(raw);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            'Formato nao suportado. Use MP3, WAV, M4A, WebM ou OGG (ou defina o tipo MIME correto no arquivo).',
        },
        { status: 400 }
      );
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const buffer = Buffer.from(await raw.arrayBuffer());

    const filePath = `users/${uid}/projects/${projectId}/audio.${resolved.ext}`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      resumable: false,
      contentType: resolved.contentType,
      public: false,
      metadata: {
        cacheControl: 'public,max-age=3600',
      },
    });
    const [audioUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2100-01-01',
    });

    const audioTokens = script.length;
    const audioCost = 0;
    const cost = {
      audioTokens,
      audioCost,
      videoSeconds: 0,
      videoCost: 0,
      totalCost: audioCost,
    };

    await adminDb.collection('users').doc(uid).collection('projects').doc(projectId).set(
      {
        id: projectId,
        generatedScript: script || undefined,
        status: 'audio_review',
        audioUrl,
        cost,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ audioUrl, cost });
  } catch (error) {
    console.error('upload-audio', error);
    const name = getResolvedStorageBucketName() || '(bucket desconhecido)';
    const message = describeStorageFailure(error, name);
    return NextResponse.json(
      {
        error: message,
        ...(process.env.NODE_ENV === 'development' && {
          debug: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    );
  }
}
