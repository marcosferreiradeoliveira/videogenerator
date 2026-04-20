import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';

type Body = { idToken?: string };

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as Body;
    const idToken = body.idToken?.trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token ausente.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get();
    const keys = sanitizeApiKeysDoc(snap.data());

    if (!keys.elevenlabs) {
      return NextResponse.json({ error: 'Configure a chave ElevenLabs em Configuracoes.' }, { status: 400 });
    }

    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': keys.elevenlabs },
    });

    if (!res.ok) {
      const t = await res.text();
      try {
        const parsed = JSON.parse(t) as {
          detail?: { status?: string; message?: string; code?: string };
        };
        const d = parsed.detail;
        if (d && typeof d === 'object') {
          const msg = d.message || '';
          if (d.status === 'missing_permissions' && msg.includes('voices_read')) {
            return NextResponse.json(
              {
                code: 'missing_voices_read',
                error:
                  'Sua chave API nao tem permissao voices_read (só é necessaria para listar vozes aqui). ' +
                  'No ElevenLabs: Developers → API keys → edite a chave e marque voices_read e text_to_speech, ' +
                  'ou crie outra chave com essas permissoes. ' +
                  'Alternativa: cole o Voice ID manualmente no campo acima — gerar audio usa só text_to_speech.',
              },
              { status: 403 }
            );
          }
          if (msg) {
            return NextResponse.json({ error: msg }, { status: res.status >= 400 ? res.status : 502 });
          }
        }
      } catch {
        // texto nao-json
      }
      return NextResponse.json({ error: t || String(res.status) }, { status: 502 });
    }

    const data = (await res.json()) as {
      voices?: Array<{ voice_id?: string; name?: string }>;
    };
    const voices = (data.voices || [])
      .filter((v) => v.voice_id && v.name)
      .map((v) => ({ voice_id: v.voice_id as string, name: v.name as string }));

    return NextResponse.json({ voices });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Falha ao listar vozes.' }, { status: 500 });
  }
}
