import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { heygenListAvatars } from '@/lib/heygen';
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
      return NextResponse.json({ error: 'Configure a chave HeyGen primeiro.' }, { status: 400 });
    }

    const { avatars, talking_photos } = await heygenListAvatars(keys.heygen.trim());
    return NextResponse.json({ avatars, talking_photos });
  } catch (error) {
    console.error('heygen-avatars', error);
    const message = error instanceof Error ? error.message : 'Falha ao listar avatares HeyGen.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
