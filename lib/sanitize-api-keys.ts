import type { ApiKeys, HeyGenCharacterKind } from '@/types';

export function sanitizeApiKeysDoc(input: unknown): ApiKeys {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rawKind = data.heygenCharacterKind;
  const heygenCharacterKind: HeyGenCharacterKind =
    rawKind === 'talking_photo' ? 'talking_photo' : 'avatar';
  return {
    gemini: typeof data.gemini === 'string' ? data.gemini : '',
    openai: typeof data.openai === 'string' ? data.openai : '',
    elevenlabs: typeof data.elevenlabs === 'string' ? data.elevenlabs : '',
    elevenlabsVoiceId: typeof data.elevenlabsVoiceId === 'string' ? data.elevenlabsVoiceId : '',
    heygen: typeof data.heygen === 'string' ? data.heygen : '',
    heygenCharacterId: typeof data.heygenCharacterId === 'string' ? data.heygenCharacterId : '',
    heygenCharacterKind,
    kling: typeof data.kling === 'string' ? data.kling : '',
  };
}
