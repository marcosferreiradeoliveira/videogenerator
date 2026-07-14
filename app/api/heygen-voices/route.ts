import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { heygenListVoices } from '@/lib/heygen';
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

    if (!keys.heygen?.trim()) {
      return NextResponse.json({ error: 'Configure a chave HeyGen em Configuracoes.' }, { status: 400 });
    }

    const voices = await heygenListVoices(keys.heygen.trim());
    return NextResponse.json({ voices });
  } catch (e) {
    console.error('heygen-voices', e);
    const message = e instanceof Error ? e.message : 'Falha ao listar vozes HeyGen.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
