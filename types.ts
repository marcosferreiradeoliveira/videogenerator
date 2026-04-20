export type HeyGenCharacterKind = 'avatar' | 'talking_photo';

export interface ApiKeys {
  gemini: string;
  elevenlabs: string;
  elevenlabsVoiceId: string;
  heygen: string;
  /** avatar_id ou talking_photo_id (HeyGen → lista de avatares na API). */
  heygenCharacterId: string;
  heygenCharacterKind: HeyGenCharacterKind;
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
  generatedScript?: string;
  /** Notas opcionais para o vídeo (HeyGen), preenchidas na revisão de áudio. */
  promptInfo?: string;
  status: 'idle' | 'generating_script' | 'script_review' | 'generating_audio' | 'audio_review' | 'generating_video' | 'completed' | 'error';
  audioUrl?: string;
  videoUrl?: string;
  /** true quando o video e apenas amostra (fallback sem HeyGen). */
  videoIsDemo?: boolean;
  /** ID devolvido pelo HeyGen ao criar o video (polling ate `completed`). */
  heygenVideoId?: string;
  cost?: GenerationCost;
  error?: string;
}
