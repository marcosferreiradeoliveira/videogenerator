import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { heygenGetVideoStatus } from '@/lib/heygen';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';

export const maxDuration = 60;

type Body = { projectId?: string; idToken?: string };

function formatHeyGenFailure(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Render HeyGen falhou.';
  const e = err as { message?: string; detail?: string; code?: number };
  return [e.message, e.detail].filter(Boolean).join(' — ') || 'Render HeyGen falhou.';
}

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as Body;
    const projectId = body.projectId?.trim();
    const idToken = body.idToken?.trim();
    if (!projectId || !idToken) {
      return NextResponse.json({ error: 'projectId e idToken sao obrigatorios.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const keysSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get();
    const apiKeys = sanitizeApiKeysDoc(keysSnap.data());
    if (!apiKeys.heygen?.trim()) {
      return NextResponse.json({ error: 'Chave HeyGen nao configurada.' }, { status: 400 });
    }

    const projectRef = adminDb.collection('users').doc(uid).collection('projects').doc(projectId);
    const snap = await projectRef.get();
    const existing = snap.data() || {};
    const heygenVideoId =
      typeof existing.heygenVideoId === 'string' ? existing.heygenVideoId.trim() : '';
    if (!heygenVideoId) {
      return NextResponse.json({ error: 'Projeto sem heygenVideoId. Inicie a geracao de video de novo.' }, { status: 400 });
    }

    const data = await heygenGetVideoStatus(apiKeys.heygen.trim(), heygenVideoId);

    if (data.status === 'failed') {
      const errText = formatHeyGenFailure(data.error);
      await projectRef.set(
        {
          status: 'error',
          error: errText,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return NextResponse.json({ error: errText, status: 'failed' }, { status: 502 });
    }

    if (data.status !== 'completed' || !data.video_url) {
      return NextResponse.json({
        status: data.status || 'processing',
        poll: true,
      });
    }

    const durationSec = typeof data.duration === 'number' && data.duration > 0 ? data.duration : 30;
    const videoCost = Number((durationSec * 0.1).toFixed(4));
    const prevCost = (existing.cost && typeof existing.cost === 'object' ? existing.cost : {}) as Record<
      string,
      unknown
    >;
    const audioTokens = Number(prevCost.audioTokens ?? 0);
    const audioCost = Number(prevCost.audioCost ?? 0);
    const totalCost = Number((audioCost + videoCost).toFixed(4));

    await projectRef.set(
      {
        id: projectId,
        status: 'completed',
        videoUrl: data.video_url,
        videoIsDemo: false,
        cost: {
          audioTokens,
          audioCost,
          videoSeconds: Math.round(durationSec),
          videoCost,
          totalCost,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      status: 'completed',
      videoUrl: data.video_url,
      videoSeconds: Math.round(durationSec),
      videoCost,
      totalCost,
      videoIsDemo: false,
    });
  } catch (error) {
    console.error('heygen-poll', error);
    const message = error instanceof Error ? error.message : 'Falha ao consultar HeyGen.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
