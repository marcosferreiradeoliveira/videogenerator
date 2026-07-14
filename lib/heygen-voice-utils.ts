/** HeyGen API keys costumam comecar com sk_ — nao confundir com voice_id. */
export function isLikelyHeygenApiKey(value: string): boolean {
  const v = value.trim();
  return /^sk[_-]/i.test(v) || (v.length > 40 && v.includes('_') && !/^[a-f0-9]{32}$/i.test(v));
}

export function validateHeygenVoiceIdForApi(value: string): string | null {
  const id = value.trim();
  if (!id) return 'Defina o HeyGen Voice ID.';
  if (isLikelyHeygenApiKey(id)) {
    return (
      'Este valor parece ser a API Key do HeyGen (comeca com sk_), nao o Voice ID. ' +
      'Em Configuracoes: API Key vai no campo "HeyGen API Key"; o Voice ID e um codigo curto (ex.: 1bd001e7e50f421d891986aad5c8bbd2) ' +
      'obtido em "Carregar vozes HeyGen" na revisao do roteiro.'
    );
  }
  return null;
}
