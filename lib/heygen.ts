const HEYGEN_API = 'https://api.heygen.com';
const HEYGEN_UPLOAD = 'https://upload.heygen.com';

type HeyGenErr = { message?: string; code?: string; detail?: string };
export type HeyGenBackgroundInput =
  | { type: 'color'; value: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string; playStyle?: 'fit_to_scene' | 'freeze' | 'loop' | 'full_video' };

export type HeyGenTalkingPhotoInput = {
  talkingStyle?: 'stable' | 'expressive';
  useAvatarIVModel?: boolean;
  motionPrompt?: string;
  keepOriginalPrompt?: boolean;
  expression?: 'default' | 'happy';
  superResolution?: boolean;
};

function isBenignHeyGenMessage(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  return t === 'success' || t === 'ok' || t === 'successful';
}

function pickHeyGenError(json: {
  error?: string | HeyGenErr | null;
  message?: string;
  code?: number | string | null;
}): string | null {
  const e = json.error;
  if (typeof e === 'string') {
    if (!e.trim() || isBenignHeyGenMessage(e)) return null;
    return e;
  }
  if (e && typeof e === 'object') {
    const nested = e.message || e.detail || e.code || null;
    if (nested && !isBenignHeyGenMessage(String(nested))) return nested;
    return null;
  }
  // Legacy v1/v2 often put "Success" in `message` on HTTP 200 — never treat as error.
  if (json.message && !isBenignHeyGenMessage(json.message)) {
    if (json.code === 100 || json.code === '100') return null;
    return json.message;
  }
  return null;
}

function formatHeyGenApiError(status: number, errMsg: string | null, context: string): string {
  const raw = errMsg || `${context}: HTTP ${status}`;
  if (status === 401 || /unauthorized/i.test(raw)) {
    return 'API Key HeyGen invalida ou expirada. Em Configuracoes, confira a chave em HeyGen → Settings → API.';
  }
  if (/invalid voice_id|voice not found/i.test(raw)) {
    return `${raw} — A voz e definida pelo avatar escolhido. Confira o ID do personagem em Configuracoes.`;
  }
  if (status === 403) {
    return `HeyGen recusou o pedido (403). ${raw}`;
  }
  return raw;
}

export type HeyGenVoiceInput =
  | { type: 'audio'; audioUrl: string }
  | { type: 'text'; inputText: string; voiceId?: string; speed?: number };

export type HeyGenEngine = 'avatar_iv' | 'avatar_v';

export type HeyGenLookInfo = {
  id: string;
  name: string;
  avatarType: string | null;
  supportedApiEngines: string[];
};

function mapBackgroundV3(background?: HeyGenBackgroundInput): { type: 'color'; value: string } | { type: 'image'; url: string } {
  if (background?.type === 'image') {
    return { type: 'image', url: background.url };
  }
  if (background?.type === 'color') {
    return { type: 'color', value: background.value };
  }
  return { type: 'color', value: '#0f172a' };
}

/** Look details including Avatar V eligibility (`supported_api_engines`). */
export async function heygenGetLook(apiKey: string, lookId: string): Promise<HeyGenLookInfo> {
  const res = await fetch(`${HEYGEN_API}/v3/avatars/looks/${encodeURIComponent(lookId)}`, {
    headers: { 'x-api-key': apiKey },
  });
  const json = (await res.json()) as {
    data?: {
      id?: string;
      name?: string;
      avatar_type?: string | null;
      supported_api_engines?: string[];
    };
    error?: string | HeyGenErr | null;
    message?: string;
  };
  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(formatHeyGenApiError(res.status, errMsg, 'HeyGen get look'));
  }
  const d = json.data;
  if (!d?.id) {
    throw new Error('HeyGen nao devolveu dados do look.');
  }
  return {
    id: d.id,
    name: d.name || d.id,
    avatarType: d.avatar_type ?? null,
    supportedApiEngines: Array.isArray(d.supported_api_engines) ? d.supported_api_engines : [],
  };
}

export async function heygenLookSupportsEngine(
  apiKey: string,
  lookId: string,
  engine: HeyGenEngine
): Promise<HeyGenLookInfo> {
  const look = await heygenGetLook(apiKey, lookId);
  if (!look.supportedApiEngines.includes(engine)) {
    throw new Error(
      `Este personagem nao suporta ${engine === 'avatar_v' ? 'Avatar V' : 'Avatar IV'}. ` +
        `Engines disponiveis: ${look.supportedApiEngines.join(', ') || 'nenhum'}. ` +
        'Escolha um Digital Twin elegivel ou use Avatar IV.'
    );
  }
  return look;
}

/** v3: script + avatar_id sem voice_id usa a voz padrao do avatar. */
async function heygenCreateAvatarVideoV3(
  apiKey: string,
  params: {
    avatarId: string;
    script: string;
    title?: string;
    background?: HeyGenBackgroundInput;
    talkingPhoto?: HeyGenTalkingPhotoInput;
    engine?: HeyGenEngine;
  }
): Promise<string> {
  const engine = params.engine || 'avatar_iv';
  const body: Record<string, unknown> = {
    type: 'avatar',
    avatar_id: params.avatarId,
    script: params.script,
    title: params.title || 'Studio',
    background: mapBackgroundV3(params.background),
    engine: { type: engine },
  };

  if (params.talkingPhoto?.motionPrompt) {
    body.motion_prompt = params.talkingPhoto.motionPrompt;
  }
  // expressiveness is Avatar IV only (rejected on avatar_v)
  if (engine !== 'avatar_v' && params.talkingPhoto?.expression === 'happy') {
    body.expressiveness = 'high';
  }

  const res = await fetch(`${HEYGEN_API}/v3/videos`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    data?: { video_id?: string };
    error?: string | HeyGenErr | null;
    message?: string;
  };

  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(formatHeyGenApiError(res.status, errMsg, 'HeyGen create video'));
  }
  const videoId = json.data?.video_id;
  if (!videoId) {
    throw new Error('HeyGen nao devolveu video_id.');
  }
  return videoId;
}

export async function heygenCreateAvatarVideo(
  apiKey: string,
  params: {
    characterKind: 'avatar' | 'talking_photo';
    characterId: string;
    voice: HeyGenVoiceInput;
    title?: string;
    background?: HeyGenBackgroundInput;
    talkingPhoto?: HeyGenTalkingPhotoInput;
    engine?: HeyGenEngine;
  }
): Promise<string> {
  if (params.voice.type === 'text' && !params.voice.voiceId?.trim()) {
    return heygenCreateAvatarVideoV3(apiKey, {
      avatarId: params.characterId,
      script: params.voice.inputText,
      title: params.title,
      background: params.background,
      talkingPhoto: params.talkingPhoto,
      engine: params.engine,
    });
  }

  const inferredAvatarIV =
    typeof params.talkingPhoto?.useAvatarIVModel === 'boolean'
      ? params.talkingPhoto.useAvatarIVModel
      : params.talkingPhoto?.motionPrompt
        ? true
        : undefined;
  const character =
    params.characterKind === 'talking_photo'
      ? {
          type: 'talking_photo' as const,
          talking_photo_id: params.characterId,
          scale: 1,
          ...(params.talkingPhoto?.talkingStyle
            ? { talking_style: params.talkingPhoto.talkingStyle }
            : {}),
          ...(typeof inferredAvatarIV === 'boolean' ? { use_avatar_iv_model: inferredAvatarIV } : {}),
          ...(params.talkingPhoto?.motionPrompt ? { prompt: params.talkingPhoto.motionPrompt } : {}),
          ...(typeof params.talkingPhoto?.keepOriginalPrompt === 'boolean'
            ? { keep_original_prompt: params.talkingPhoto.keepOriginalPrompt }
            : {}),
          ...(params.talkingPhoto?.expression ? { expression: params.talkingPhoto.expression } : {}),
          ...(typeof params.talkingPhoto?.superResolution === 'boolean'
            ? { super_resolution: params.talkingPhoto.superResolution }
            : {}),
        }
      : { type: 'avatar' as const, avatar_id: params.characterId, scale: 1 };

  const voice =
    params.voice.type === 'audio'
      ? { type: 'audio' as const, audio_url: params.voice.audioUrl }
      : {
          type: 'text' as const,
          ...(params.voice.voiceId?.trim() ? { voice_id: params.voice.voiceId.trim() } : {}),
          input_text: params.voice.inputText,
          ...(typeof params.voice.speed === 'number' ? { speed: params.voice.speed } : {}),
        };

  const body = {
    title: params.title || 'Studio',
    video_inputs: [
      {
        character,
        voice,
        background:
          params.background?.type === 'video'
            ? {
                type: 'video' as const,
                url: params.background.url,
                ...(params.background.playStyle ? { play_style: params.background.playStyle } : {}),
              }
            : params.background?.type === 'image'
              ? { type: 'image' as const, url: params.background.url }
              : params.background?.type === 'color'
                ? { type: 'color' as const, value: params.background.value }
                : { type: 'color' as const, value: '#0f172a' },
      },
    ],
  };

  const res = await fetch(`${HEYGEN_API}/v2/video/generate`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    data?: { video_id?: string };
    error?: string | HeyGenErr | null;
    message?: string;
  };

  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(formatHeyGenApiError(res.status, errMsg, 'HeyGen create video'));
  }
  const videoId = json.data?.video_id;
  if (!videoId) {
    throw new Error('HeyGen nao devolveu video_id.');
  }
  return videoId;
}

export type HeyGenVideoStatusData = {
  id: string;
  status: string;
  video_url: string | null;
  duration: number | null;
  error: string | { message?: string; detail?: string; code?: number } | null;
};

async function heygenGetVideoStatusV3(apiKey: string, videoId: string): Promise<HeyGenVideoStatusData | null> {
  const res = await fetch(`${HEYGEN_API}/v3/videos/${encodeURIComponent(videoId)}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (res.status === 404) return null;

  const json = (await res.json()) as {
    data?: {
      id?: string;
      status?: string;
      video_url?: string | null;
      duration?: number | null;
      failure_message?: string | null;
      failure_code?: string | null;
    };
    error?: string | HeyGenErr | null;
    message?: string;
  };

  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(errMsg || `HeyGen status v3: HTTP ${res.status}`);
  }
  const d = json.data;
  if (!d?.id || !d.status) {
    throw new Error('Resposta HeyGen v3 sem dados de video.');
  }

  const failure =
    d.status === 'failed'
      ? [d.failure_message, d.failure_code].filter(Boolean).join(' — ') || 'Render HeyGen falhou.'
      : null;

  return {
    id: d.id,
    status: d.status,
    video_url: d.video_url ?? null,
    duration: typeof d.duration === 'number' ? d.duration : null,
    error: failure,
  };
}

async function heygenGetVideoStatusV1(apiKey: string, videoId: string): Promise<HeyGenVideoStatusData> {
  const url = `${HEYGEN_API}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  const json = (await res.json()) as {
    data?: HeyGenVideoStatusData;
    error?: string | HeyGenErr | null;
    message?: string;
    code?: number;
  };

  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(errMsg || `HeyGen status: HTTP ${res.status}`);
  }
  if (!json.data) {
    throw new Error('Resposta HeyGen sem dados de video.');
  }
  return json.data;
}

export async function heygenGetVideoStatus(apiKey: string, videoId: string): Promise<HeyGenVideoStatusData> {
  try {
    const v3 = await heygenGetVideoStatusV3(apiKey, videoId);
    if (v3) return v3;
  } catch {
    // Fall back to legacy status for older video IDs.
  }
  return heygenGetVideoStatusV1(apiKey, videoId);
}

/** Faz upload de audio para HeyGen e devolve URL publica para usar em audio_url. */
export async function heygenUploadAudioAsset(apiKey: string, bytes: Buffer, contentType: string): Promise<string> {
  const allowed = ['audio/mpeg', 'audio/wav', 'audio/x-wav'];
  const ct = allowed.includes(contentType) ? contentType : 'audio/mpeg';

  const res = await fetch(`${HEYGEN_UPLOAD}/v1/asset`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': ct,
    },
    body: new Uint8Array(bytes),
  });
  const json = (await res.json()) as {
    code?: number;
    data?: { url?: string };
    message?: string;
    error?: string | HeyGenErr;
  };

  if (!res.ok || json.code !== 100 || !json.data?.url) {
    const msg =
      pickHeyGenError(json as { error?: string | HeyGenErr }) ||
      json.message ||
      `HeyGen upload audio: HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data.url;
}

export async function heygenListVoices(
  apiKey: string
): Promise<{ voice_id: string; name: string; language: string }[]> {
  const all: { voice_id: string; name: string; language: string }[] = [];
  let token: string | undefined;

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      engine: 'starfish',
      limit: '100',
    });
    if (token) params.set('token', token);

    const res = await fetch(`${HEYGEN_API}/v3/voices?${params}`, {
      headers: { 'x-api-key': apiKey },
    });
    const json = (await res.json()) as {
      data?: Array<{ voice_id?: string; name?: string; language?: string }>;
      voices?: Array<{ voice_id?: string; name?: string; language?: string }>;
      has_more?: boolean;
      next_token?: string | null;
      error?: string | HeyGenErr | null;
      message?: string;
    };

    const errMsg = pickHeyGenError(json);
    if (!res.ok || errMsg) {
      throw new Error(formatHeyGenApiError(res.status, errMsg, 'HeyGen list voices'));
    }

    const batch = json.data ?? json.voices ?? [];
    for (const v of batch) {
      if (v.voice_id && v.name) {
        all.push({
          voice_id: v.voice_id,
          name: v.name,
          language: v.language || '',
        });
      }
    }

    if (!json.has_more || !json.next_token) break;
    token = json.next_token;
  }

  return all;
}

export async function heygenListAvatars(apiKey: string): Promise<{
  avatars: { avatar_id: string; avatar_name: string }[];
  talking_photos: { talking_photo_id: string; talking_photo_name: string }[];
}> {
  const res = await fetch(`${HEYGEN_API}/v2/avatars`, {
    headers: { 'x-api-key': apiKey },
  });
  const json = (await res.json()) as {
    data?: {
      avatars?: { avatar_id: string; avatar_name: string }[];
      talking_photos?: { talking_photo_id: string; talking_photo_name: string }[];
    };
    error?: string | HeyGenErr | null;
  };
  const errMsg = pickHeyGenError(json);
  if (!res.ok || errMsg) {
    throw new Error(errMsg || `HeyGen list avatars: HTTP ${res.status}`);
  }
  return {
    avatars: json.data?.avatars || [],
    talking_photos: json.data?.talking_photos || [],
  };
}
