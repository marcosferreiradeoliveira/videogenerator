import { GoogleGenAI } from '@google/genai';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'ingles',
  es: 'espanhol',
  pt: 'portugues',
  fr: 'frances',
  de: 'alemao',
  it: 'italiano',
  ja: 'japones',
  ko: 'coreano',
  zh: 'chines simplificado',
  ar: 'arabe',
  hi: 'hindi',
  ru: 'russo',
};

export function languageLabel(code: string): string {
  return LANGUAGE_NAMES[code] || code;
}

export async function translateTranscript(
  text: string,
  targetLanguageCode: string,
  keys: { gemini?: string; openai?: string }
): Promise<string> {
  const targetName = languageLabel(targetLanguageCode);
  const prompt = `Traduza o texto abaixo para ${targetName}. Mantenha o sentido e o tom de fala natural para narracao em video. Responda APENAS com o texto traduzido, sem aspas, titulos ou comentarios.

Texto:
${text}`;

  if (keys.gemini) {
    const ai = new GoogleGenAI({ apiKey: keys.gemini });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const translated = response.text?.trim() || '';
    if (!translated) throw new Error('Traducao vazia (Gemini).');
    return translated;
  }

  if (keys.openai) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keys.openai}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Voce traduz textos para ${targetName}. Responda apenas com a traducao.`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error('Falha ao traduzir com OpenAI.');
    const data = await res.json();
    const translated = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!translated) throw new Error('Traducao vazia (OpenAI).');
    return translated;
  }

  throw new Error('Configure Gemini ou OpenAI em Configuracoes para traduzir.');
}
