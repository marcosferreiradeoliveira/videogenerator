import { NextResponse } from 'next/server';
import {
  adminAuth,
  adminDb,
  describeStorageFailure,
  getAdminStorageBucket,
  getResolvedStorageBucketName,
  isAdminConfigured,
} from '@/lib/firebase-admin';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';

type GenerateAudioPayload = {
  projectId?: string;
  script?: string;
  idToken?: string;
};

/** Opcional no servidor: voz padrao paga (ex. Rachel). Plano free da ElevenLabs nao aceita vozes de biblioteca pela API. */

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }
  const storageBucket = getAdminStorageBucket();
  const storageBucketName = getResolvedStorageBucketName();
  if (!storageBucket || !storageBucketName) {
    return NextResponse.json(
      {
        error:
          'Firebase Storage nao configurado: defina FIREBASE_ADMIN_STORAGE_BUCKET ou NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET com o nome do bucket (Console Firebase > Storage).',
      },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as GenerateAudioPayload;
    const projectId = body.projectId?.trim();
    const script = body.script?.trim();
    const idToken = body.idToken?.trim();

    if (!projectId || !script || !idToken) {
      return NextResponse.json({ error: 'Dados invalidos para gerar audio.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const keysSnapshot = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get();
    const apiKeys = sanitizeApiKeysDoc(keysSnapshot.data());

    if (!apiKeys.elevenlabs) {
      return NextResponse.json({ error: 'Configure a chave da ElevenLabs em Configuracoes.' }, { status: 400 });
    }

    const voiceId =
      apiKeys.elevenlabsVoiceId?.trim() || process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim() || '';
    if (!voiceId) {
      return NextResponse.json(
        {
          error:
            'Defina o Voice ID da ElevenLabs (voz da SUA conta, nao da Voice Library). No site: My Voices / suas vozes — copie o voice_id. No plano gratuito, vozes de biblioteca (ex. Rachel padrao) sao bloqueadas na API.',
        },
        { status: 400 }
      );
    }
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKeys.elevenlabs,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
      }),
    });

    if (!ttsResponse.ok) {
      const text = await ttsResponse.text();
      let message = text || String(ttsResponse.status);
      try {
        const parsed = JSON.parse(text) as {
          detail?: { type?: string; code?: string; message?: string } | string;
        };
        const detail = parsed.detail;
        const d =
          detail && typeof detail === 'object'
            ? detail
            : typeof detail === 'string'
              ? { message: detail }
              : {};
        if (d.code === 'paid_plan_required' || d.type === 'payment_required') {
          message =
            d.message ||
            'No plano gratuito, a ElevenLabs bloqueia vozes de biblioteca na API. Use um voice_id de uma voz que apareca em "My Voices" na sua conta (ou faca upgrade do plano).';
        } else if (d.message) {
          message = d.message;
        }
      } catch {
        // mantem texto bruto
      }
      return NextResponse.json({ error: message }, { status: ttsResponse.status === 402 ? 402 : 502 });
    }

    const audioArrayBuffer = await ttsResponse.arrayBuffer();
    if (audioArrayBuffer.byteLength < 1024) {
      return NextResponse.json({ error: 'Audio retornado invalido pela ElevenLabs.' }, { status: 502 });
    }
    const audioBuffer = Buffer.from(audioArrayBuffer);

    const filePath = `users/${uid}/projects/${projectId}/audio.mp3`;
    const file = storageBucket.file(filePath);
    await file.save(audioBuffer, {
      resumable: false,
      contentType: 'audio/mpeg',
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
    const audioCost = Number((audioTokens * 0.00015).toFixed(4));

    await adminDb.collection('users').doc(uid).collection('projects').doc(projectId).set(
      {
        id: projectId,
        generatedScript: script,
        status: 'audio_review',
        audioUrl,
        cost: {
          audioTokens,
          audioCost,
          videoSeconds: 0,
          videoCost: 0,
          totalCost: audioCost,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      audioUrl,
      cost: {
        audioTokens,
        audioCost,
        videoSeconds: 0,
        videoCost: 0,
        totalCost: audioCost,
      },
    });
  } catch (error) {
    console.error('generate-audio', error);
    const raw = error instanceof Error ? error.message : String(error);
    if (/bucket|storage\.googleapis|@google-cloud\/storage|signblob|does not exist|permission|forbidden|404|403/i.test(raw)) {
      return NextResponse.json(
        {
          error: describeStorageFailure(error, storageBucketName),
          ...(process.env.NODE_ENV === 'development' && { debug: raw }),
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Falha interna ao gerar audio.' }, { status: 500 });
  }
}
