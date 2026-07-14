export type HeyGenCharacterKind = 'avatar' | 'talking_photo';
/** Motor de render HeyGen v3. Avatar V exige look elegivel (digital_twin). */
export type HeyGenEnginePreference = 'avatar_iv' | 'avatar_v';

export interface ApiKeys {
  gemini: string;
  elevenlabs: string;
  elevenlabsVoiceId: string;
  heygen: string;
  /** voice_id da biblioteca HeyGen (TTS nativo, sem ElevenLabs). */
  heygenVoiceId: string;
  /** avatar_id ou talking_photo_id (HeyGen → lista de avatares na API). */
  heygenCharacterId: string;
  heygenCharacterKind: HeyGenCharacterKind;
  /** Preferencia de engine no fluxo voz HeyGen (v3). Default: avatar_iv. */
  heygenEngine: HeyGenEnginePreference;
  kling: string;
  openai: string;
}

export interface GenerationCost {
  audioTokens: number;
  audioCost: number;
  videoSeconds: number;
  videoCost: number;
  totalCost: number;
}

export interface VideoProject {
  id: string;
  date: string;
  rawMaterial: string;
  /** Duração alvo do vídeo em segundos; usada para dimensionar o roteiro. */
  targetVideoDurationSeconds?: number;
  generatedScript?: string;
  /** Notas opcionais para o vídeo (HeyGen), preenchidas na revisão de áudio. */
  promptInfo?: string;
  status: 'idle' | 'generating_script' | 'script_review' | 'generating_audio' | 'audio_review' | 'generating_video' | 'completed' | 'error';
  /** Origem do áudio: ElevenLabs/upload ou TTS nativo do HeyGen. */
  audioSource?: 'elevenlabs' | 'heygen';
  audioUrl?: string;
  videoUrl?: string;
  /** true quando o video e apenas amostra (fallback sem HeyGen). */
  videoIsDemo?: boolean;
  /** ID devolvido pelo HeyGen ao criar o video (polling ate `completed`). */
  heygenVideoId?: string;
  cost?: GenerationCost;
  error?: string;
}

export const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês (simplificado)' },
  { code: 'ar', label: 'Árabe' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ru', label: 'Russo' },
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]['code'];

export interface TranslationProject {
  id: string;
  date: string;
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'error';
  sourceVideoUrl?: string;
  outputVideoUrl?: string;
  targetLanguage: string;
  /** Se definido, processa apenas os N primeiros segundos do video. */
  clipDurationSeconds?: number;
  sourceDurationSeconds?: number;
  originalTranscript?: string;
  translatedTranscript?: string;
  error?: string;
}
