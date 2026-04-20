import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import {
  heygenCreateAvatarVideo,
  heygenUploadAudioAsset,
  type HeyGenBackgroundInput,
} from '@/lib/heygen';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';
import type { HeyGenCharacterKind } from '@/types';

export const maxDuration = 120;

type GenerateVideoPayload = {
  projectId?: string;
  script?: string;
  currentAudioCost?: number;
  videoNotes?: string;
  idToken?: string;
};

function buildHeygenTitle(projectId: string, notes?: string): string {
  const shortId = projectId.slice(0, 8);
  if (!notes?.trim()) return `NewsGen — ${shortId}`;
  const combined = `NewsGen — ${shortId} · ${notes.trim()}`;
  return combined.length > 200 ? `${combined.slice(0, 197)}...` : combined;
}

async function downloadAudio(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download do audio falhou (HTTP ${res.status}).`);
  }
  const ct = res.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 256) {
    throw new Error('Ficheiro de audio demasiado pequeno ou vazio.');
  }
  return { buffer, contentType: ct };
}

function resolveCharacter(apiKeys: ReturnType<typeof sanitizeApiKeysDoc>): {
  id: string;
  kind: HeyGenCharacterKind;
} {
  let id = apiKeys.heygenCharacterId.trim();
  let kind: HeyGenCharacterKind = apiKeys.heygenCharacterKind;
  const envId = process.env.HEYGEN_DEFAULT_CHARACTER_ID?.trim();
  if (!id && envId) {
    id = envId;
    kind =
      process.env.HEYGEN_DEFAULT_CHARACTER_KIND === 'talking_photo' ? 'talking_photo' : 'avatar';
  }
  return { id, kind };
}

function parseBackgroundFromNotes(videoNotes?: string): HeyGenBackgroundInput | undefined {
  const raw = videoNotes?.trim();
  if (!raw) return undefined;

  // Supported examples:
  // bg_color:#0f172a
  // bg_image:https://site.com/studio.jpg
  // bg_video:https://site.com/loop.mp4
  // https://site.com/studio.jpg
  // #0f172a
  const colorDirective = raw.match(
    /(?:^|\s)(?:bg_color|background_color)\s*:\s*(#[0-9a-fA-F]{3,8})(?=\s|$)/i
  )?.[1];
  if (colorDirective) return { type: 'color', value: colorDirective };

  const imageDirective = raw.match(
    /(?:^|\s)(?:bg_image|background_image)\s*:\s*(https?:\/\/\S+)(?=\s|$)/i
  )?.[1];
  if (imageDirective) return { type: 'image', url: imageDirective };

  const videoDirective = raw.match(
    /(?:^|\s)(?:bg_video|background_video)\s*:\s*(https?:\/\/\S+)(?=\s|$)/i
  )?.[1];
  if (videoDirective) return { type: 'video', url: videoDirective, playStyle: 'loop' };

  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return { type: 'color', value: raw };
  if (/^https?:\/\/\S+$/i.test(raw)) {
    const lower = raw.toLowerCase();
    if (/\.(mp4|webm|mov)(\?.*)?$/.test(lower)) return { type: 'video', url: raw, playStyle: 'loop' };
    return { type: 'image', url: raw };
  }

  // Free text is preserved as notes/title context but does not map 1:1 to an official HeyGen prompt field.
  return undefined;
}

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as GenerateVideoPayload;
    const projectId = body.projectId?.trim();
    const script = body.script?.trim();
    const idToken = body.idToken?.trim();
    const videoNotes = body.videoNotes?.trim();

    if (!projectId || !script || !idToken) {
      return NextResponse.json({ error: 'Dados invalidos para gerar video.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);

    const keysSnap = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get();
    const apiKeys = sanitizeApiKeysDoc(keysSnap.data());

    if (!apiKeys.heygen?.trim()) {
      return NextResponse.json(
        { error: 'Configure a API Key do HeyGen em Configuracoes (e o avatar / talking photo).' },
        { status: 400 }
      );
    }

    const { id: characterId, kind: characterKind } = resolveCharacter(apiKeys);
    if (!characterId) {
      return NextResponse.json(
        {
          error:
            'Defina o ID do personagem HeyGen (avatar_id ou talking_photo_id). Use Configuracoes → carregar lista ou cole o ID da documentacao HeyGen.',
        },
        { status: 400 }
      );
    }

    const projectRef = adminDb.collection('users').doc(uid).collection('projects').doc(projectId);
    const snap = await projectRef.get();
    const existing = snap.data() || {};
    const audioUrl = typeof existing.audioUrl === 'string' ? existing.audioUrl.trim() : '';
    if (!audioUrl) {
      return NextResponse.json(
        { error: 'Nenhum audio no projeto. Gere ou envie audio antes do video.' },
        { status: 400 }
      );
    }

    const prevCost = (existing.cost && typeof existing.cost === 'object' ? existing.cost : {}) as Record<
      string,
      unknown
    >;
    const audioTokens = Number(prevCost.audioTokens ?? script.length);
    const audioCost = Number(prevCost.audioCost ?? body.currentAudioCost ?? 0);

    const heygenKey = apiKeys.heygen.trim();
    const heygenTitle = buildHeygenTitle(projectId, videoNotes);
    const heygenBackground = parseBackgroundFromNotes(videoNotes);
    let videoId: string;

    try {
      videoId = await heygenCreateAvatarVideo(heygenKey, {
        characterKind,
        characterId,
        audioUrl,
        title: heygenTitle,
        background: heygenBackground,
      });
    } catch (firstErr) {
      try {
        const { buffer, contentType } = await downloadAudio(audioUrl);
        let uploadType = 'audio/mpeg';
        if (contentType.includes('wav')) uploadType = 'audio/wav';
        else if (contentType.includes('mpeg') || contentType.includes('mp3')) uploadType = 'audio/mpeg';
        const heygenAudioUrl = await heygenUploadAudioAsset(heygenKey, buffer, uploadType);
        videoId = await heygenCreateAvatarVideo(heygenKey, {
          characterKind,
          characterId,
          audioUrl: heygenAudioUrl,
          title: heygenTitle,
          background: heygenBackground,
        });
      } catch (rehostErr) {
        const r = rehostErr instanceof Error ? rehostErr.message : String(rehostErr);
        const f = firstErr instanceof Error ? firstErr.message : String(firstErr);
        throw new Error(`${r} (URL direta: ${f})`);
      }
    }

    await projectRef.set(
      {
        id: projectId,
        status: 'generating_video',
        heygenVideoId: videoId,
        videoIsDemo: false,
        promptInfo: videoNotes || undefined,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      heygenVideoId: videoId,
      poll: true,
      audioTokens,
      audioCost,
    });
  } catch (error) {
    console.error('generate-video', error);
    const message = error instanceof Error ? error.message : 'Falha interna ao gerar video.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
