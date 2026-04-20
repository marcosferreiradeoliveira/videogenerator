const HEYGEN_API = 'https://api.heygen.com';
const HEYGEN_UPLOAD = 'https://upload.heygen.com';

type HeyGenErr = { message?: string; code?: string; detail?: string };
export type HeyGenBackgroundInput =
  | { type: 'color'; value: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string; playStyle?: 'fit_to_scene' | 'freeze' | 'loop' | 'full_video' };

function pickHeyGenError(json: { error?: string | HeyGenErr | null; message?: string }): string | null {
  const e = json.error;
  if (!e) return null;
  if (typeof e === 'string') return e;
  return e.message || e.detail || e.code || null;
}

export async function heygenCreateAvatarVideo(
  apiKey: string,
  params: {
    characterKind: 'avatar' | 'talking_photo';
    characterId: string;
    audioUrl: string;
    title?: string;
    background?: HeyGenBackgroundInput;
  }
): Promise<string> {
  const character =
    params.characterKind === 'talking_photo'
      ? { type: 'talking_photo' as const, talking_photo_id: params.characterId, scale: 1 }
      : { type: 'avatar' as const, avatar_id: params.characterId, scale: 1 };

  const body = {
    title: params.title || 'NewsGen AI',
    video_inputs: [
      {
        character,
        voice: { type: 'audio' as const, audio_url: params.audioUrl },
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
    throw new Error(errMsg || `HeyGen create video: HTTP ${res.status}`);
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

export async function heygenGetVideoStatus(apiKey: string, videoId: string): Promise<HeyGenVideoStatusData> {
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
