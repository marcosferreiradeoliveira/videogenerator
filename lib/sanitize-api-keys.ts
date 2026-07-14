import type { ApiKeys, HeyGenCharacterKind, HeyGenEnginePreference } from '@/types';

export function sanitizeApiKeysDoc(input: unknown): ApiKeys {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rawKind = data.heygenCharacterKind;
  const heygenCharacterKind: HeyGenCharacterKind =
    rawKind === 'talking_photo' ? 'talking_photo' : 'avatar';
  const heygenEngine: HeyGenEnginePreference =
    data.heygenEngine === 'avatar_v' ? 'avatar_v' : 'avatar_iv';
  return {
    gemini: typeof data.gemini === 'string' ? data.gemini : '',
    openai: typeof data.openai === 'string' ? data.openai : '',
    elevenlabs: typeof data.elevenlabs === 'string' ? data.elevenlabs : '',
    elevenlabsVoiceId: typeof data.elevenlabsVoiceId === 'string' ? data.elevenlabsVoiceId : '',
    heygen: typeof data.heygen === 'string' ? data.heygen : '',
    heygenVoiceId: typeof data.heygenVoiceId === 'string' ? data.heygenVoiceId : '',
    heygenCharacterId: typeof data.heygenCharacterId === 'string' ? data.heygenCharacterId : '',
    heygenCharacterKind,
    heygenEngine,
    kling: typeof data.kling === 'string' ? data.kling : '',
  };
}
