import { NextResponse } from 'next/server';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import {
  heygenCreateAvatarVideo,
  heygenListAvatars,
  heygenUploadAudioAsset,
  type HeyGenBackgroundInput,
  type HeyGenTalkingPhotoInput,
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
  const human = stripTechnicalDirectives(notes);
  if (!human) return `NewsGen — ${shortId}`;
  const combined = `NewsGen — ${shortId} · ${human}`;
  return combined.length > 200 ? `${combined.slice(0, 197)}...` : combined;
}

/** Partes separadas por vírgula, ponto e vírgula ou quebra de linha (formato do campo de notas). */
function splitNoteSegments(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Remove diretivas técnicas (fundo HeyGen, motion etc.) para usar só contexto livre no título. */
function stripTechnicalDirectives(notes?: string): string | undefined {
  const s = notes?.trim();
  if (!s) return undefined;
  let t = s;
  t = t.replace(
    /(?:^|[\s,;])(?:bg_color|bg_image|bg_video|background_color|background_image|background_video)\s*:\s*[^\s,;]+/gi,
    ' '
  );
  t = t.replace(
    /(?:^|[\s,;])(?:talking_style|tp_talking_style|avatar_iv|use_avatar_iv|motion_prompt|avatar_prompt|keep_original_prompt|tp_expression|expression|super_resolution)\s*:\s*[^\n,;]+/gi,
    ' '
  );
  t = t.replace(/[\s,;]{2,}/g, ' ').trim();
  return t || undefined;
}

/** Última diretiva de fundo no texto (ordem da esquerda para a direita). */
function lastBackgroundInText(s: string): HeyGenBackgroundInput | undefined {
  type Hit = { index: number; bg: HeyGenBackgroundInput };
  const hits: Hit[] = [];

  const pushAll = (re: RegExp, map: (m: RegExpMatchArray) => HeyGenBackgroundInput) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(s)) !== null) {
      hits.push({ index: m.index, bg: map(m) });
    }
  };

  pushAll(/(?:^|[\s,;])(?:bg_video|background_video)\s*:\s*(https?:\/\/[^\s,;]+)/gi, (m) => ({
    type: 'video' as const,
    url: m[1],
    playStyle: 'loop' as const,
  }));
  pushAll(/(?:^|[\s,;])(?:bg_image|background_image)\s*:\s*(https?:\/\/[^\s,;]+)/gi, (m) => ({
    type: 'image' as const,
    url: m[1],
  }));
  pushAll(/(?:^|[\s,;])(?:bg_color|background_color)\s*:\s*(#[0-9a-fA-F]{3,8})\b/gi, (m) => ({
    type: 'color' as const,
    value: m[1],
  }));

  if (hits.length === 0) return undefined;
  hits.sort((a, b) => a.index - b.index);
  return hits[hits.length - 1].bg;
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

async function normalizeCharacterKind(
  apiKey: string,
  character: { id: string; kind: HeyGenCharacterKind }
): Promise<{ id: string; kind: HeyGenCharacterKind }> {
  if (!character.id) return character;

  // Prevent common mismatch: avatar_id saved with talking_photo kind.
  if (character.kind === 'talking_photo') {
    try {
      const { avatars } = await heygenListAvatars(apiKey);
      const isAvatarId = avatars.some((a) => a.avatar_id === character.id);
      if (isAvatarId) {
        return { ...character, kind: 'avatar' };
      }
    } catch {
      // If list call fails, keep original behavior and let create endpoint return details.
    }
  }

  return character;
}

function parseBackgroundFromNotes(videoNotes?: string): HeyGenBackgroundInput | undefined {
  const raw = videoNotes?.trim();
  if (!raw) return undefined;

  // Vírgula, ponto e vírgula ou linha separam diretivas; dentro de um bloco vale a última diretiva de fundo.
  // Ex.: bg_color:#0f172a,bg_image:https://... → usa a imagem (última).
  let last: HeyGenBackgroundInput | undefined;
  for (const part of splitNoteSegments(raw)) {
    const found = lastBackgroundInText(part);
    if (found) last = found;
  }
  if (last) return last;

  const t = raw.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return { type: 'color', value: t };
  if (/^https?:\/\/\S+$/i.test(t)) {
    const lower = t.toLowerCase();
    if (/\.(mp4|webm|mov)(\?.*)?$/.test(lower)) return { type: 'video', url: t, playStyle: 'loop' };
    return { type: 'image', url: t };
  }

  return undefined;
}

function parseBooleanDirective(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'sim'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'nao', 'não'].includes(v)) return false;
  return undefined;
}

function applyTalkingPhotoToken(cfg: HeyGenTalkingPhotoInput, key: string, value: string) {
  const k = key.toLowerCase();
  const v = value.trim();

  if (k === 'talking_style' || k === 'tp_talking_style') {
    if (v === 'stable' || v === 'expressive') cfg.talkingStyle = v;
    return;
  }
  if (k === 'avatar_iv' || k === 'use_avatar_iv') {
    const b = parseBooleanDirective(v);
    if (typeof b === 'boolean') cfg.useAvatarIVModel = b;
    return;
  }
  if (k === 'motion_prompt' || k === 'avatar_prompt') {
    if (v) cfg.motionPrompt = v;
    return;
  }
  if (k === 'keep_original_prompt') {
    const b = parseBooleanDirective(v);
    if (typeof b === 'boolean') cfg.keepOriginalPrompt = b;
    return;
  }
  if (k === 'tp_expression' || k === 'expression') {
    if (v === 'default' || v === 'happy') cfg.expression = v;
    return;
  }
  if (k === 'super_resolution') {
    const b = parseBooleanDirective(v);
    if (typeof b === 'boolean') cfg.superResolution = b;
  }
}

function parseTalkingPhotoFromNotes(videoNotes?: string): HeyGenTalkingPhotoInput | undefined {
  const raw = videoNotes?.trim();
  if (!raw) return undefined;

  const cfg: HeyGenTalkingPhotoInput = {};
  const tokenRe =
    /(?:^|[\s,;])(talking_style|tp_talking_style|avatar_iv|use_avatar_iv|motion_prompt|avatar_prompt|keep_original_prompt|tp_expression|expression|super_resolution)\s*:\s*([^\n,;]+)/gi;

  for (const part of splitNoteSegments(raw)) {
    let m: RegExpExecArray | null;
    const r = new RegExp(tokenRe.source, tokenRe.flags);
    while ((m = r.exec(part)) !== null) {
      applyTalkingPhotoToken(cfg, m[1], m[2]);
    }
  }

  return Object.keys(cfg).length > 0 ? cfg : undefined;
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

    const resolvedCharacter = resolveCharacter(apiKeys);
    const heygenKey = apiKeys.heygen.trim();
    const normalizedCharacter = await normalizeCharacterKind(heygenKey, resolvedCharacter);
    const { id: characterId, kind: characterKind } = normalizedCharacter;
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

    const heygenTitle = buildHeygenTitle(projectId, videoNotes);
    const heygenBackground = parseBackgroundFromNotes(videoNotes);
    const notesTalkingPhoto = parseTalkingPhotoFromNotes(videoNotes);
    const heygenTalkingPhoto: HeyGenTalkingPhotoInput | undefined =
      characterKind === 'talking_photo'
        ? {
            talkingStyle: 'expressive',
            useAvatarIVModel: true,
            ...(notesTalkingPhoto || {}),
          }
        : undefined;
    let videoId: string;

    try {
      videoId = await heygenCreateAvatarVideo(heygenKey, {
        characterKind,
        characterId,
        audioUrl,
        title: heygenTitle,
        background: heygenBackground,
        talkingPhoto: heygenTalkingPhoto,
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
          talkingPhoto: heygenTalkingPhoto,
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
