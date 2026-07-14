import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import type { TranslationProject } from '@/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as { idToken?: string };
    const idToken = body.idToken?.trim();
    if (!idToken) {
      return NextResponse.json({ error: 'idToken obrigatorio.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    const snap = await adminDb
      .collection('users')
      .doc(uid)
      .collection('translations')
      .orderBy('date', 'desc')
      .get();

    const items: TranslationProject[] = snap.docs.map((d) => ({
      ...(d.data() as TranslationProject),
      id: d.id,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error('translations-list', error);
    return NextResponse.json({ error: 'Falha ao carregar traducoes.' }, { status: 500 });
  }
}
