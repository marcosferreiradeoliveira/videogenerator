import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';

type GenerateScriptPayload = {
  projectId?: string;
  rawMaterial: string;
  promptInfo?: string;
  /** Segundos de narração alvo (15–600). */
  targetVideoDurationSeconds?: number;
  idToken: string;
};

function clampTargetDurationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(600, Math.max(15, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return Math.min(600, Math.max(15, n));
  }
  return 60;
}

/** Faixa de palavras proporcional à duração (~2.0–2.5 palavras/s em PT, ritmo jornalístico). */
function scriptWordGuidance(seconds: number): { min: number; max: number; approx: number } {
  const min = Math.max(35, Math.floor(seconds * 1.85));
  const max = Math.max(min + 20, Math.ceil(seconds * 2.55));
  const approx = Math.round((min + max) / 2);
  return { min, max, approx };
}

/** Remove markdown, rótulos tipo ÂNCORA/ROTEIRO e frases de abertura meta antes do texto falado. */
function cleanGeneratedScript(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  // Unwrap markdown bold/italic (várias passagens para aninhamento simples)
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1');
    if (next === s) break;
    s = next;
  }

  const roleLabel =
    '(âncora|Âncora|ancora|ÂNCORA|ANCORA|roteiro|lead|abertura|fechamento|narra[cç][aã]o|texto\\s+falado|voz\\s+do\\s+(âncora|Âncora|ancora))';
  const labelLineOnly = new RegExp(
    `^\\s*#*\\s*(\\*{0,2}\\s*)?(${roleLabel})(\\s*[:：]?\\s*)(\\*{0,2}\\s*)?$`,
    'i'
  );

  const introLine =
    /^\s*(aqui\s+(est[áa]|vai|segue)|abaixo\s+(est[áa]|vai)|segue\s+(abaixo\s+)?(o\s+)?texto|eis\s+o\s+texto|este\s+[ée]\s+o\s+roteiro|sem\s+mais\s+delongas|vamos\s+ao\s+texto)\b/i;

  const lines = s.split(/\r?\n/);
  const out: string[] = [];
  let seenBody = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (out.length > 0) out.push('');
      continue;
    }
    if (labelLineOnly.test(t)) continue;
    if (!seenBody && introLine.test(t)) continue;
    seenBody = true;
    out.push(line.trimEnd());
  }

  s = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Primeira linha: remove prefixo tipo "Âncora: ..." ou "** Roteiro **" já sem asteriscos
  if (s) {
    const firstNl = s.indexOf('\n');
    const head = firstNl === -1 ? s : s.slice(0, firstNl);
    const tail = firstNl === -1 ? '' : s.slice(firstNl);
    const strippedHead = head.replace(
      new RegExp(`^\\s*(\\*{0,2}\\s*)?(#+\\s*)?(${roleLabel})(\\s*[:：]\\s*)(\\*{0,2}\\s*)?`, 'i'),
      ''
    );
    s = (strippedHead + tail).trim();
  }

  return s.trim();
}

const SCRIPT_INSTRUCTIONS = `Regras de saída (obrigatório):
- Responda APENAS com o texto que o âncora vai falar, em português, em parágrafos corridos ou frases curtas naturais.
- NÃO use markdown (nada de **, #, listas com -).
- NÃO escreva rótulos como "Âncora:", "Roteiro:", "Lead:", "Abertura:" ou títulos de seção.
- NÃO use frases introdutórias como "Aqui vai o texto", "Segue o roteiro", "Abaixo está" ou qualquer comentário sobre o que você está entregando.
- Comece direto na primeira frase do jornal.`;

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as GenerateScriptPayload;
    const projectId = body.projectId?.trim();
    const rawMaterial = body.rawMaterial?.trim();
    const promptInfo = body.promptInfo?.trim() || '';
    const idToken = body.idToken?.trim();
    const targetVideoDurationSeconds = clampTargetDurationSeconds(body.targetVideoDurationSeconds);
    const { min: wordMin, max: wordMax, approx: wordApprox } = scriptWordGuidance(targetVideoDurationSeconds);

    if (!rawMaterial || !idToken || !projectId) {
      return NextResponse.json({ error: 'Dados invalidos para gerar roteiro.' }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const keysDocRef = adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys');
    const keysSnapshot = await keysDocRef.get();
    const apiKeys = sanitizeApiKeysDoc(keysSnapshot.data());

    if (!apiKeys.gemini && !apiKeys.openai) {
      return NextResponse.json(
        { error: 'Configure a chave Gemini ou OpenAI em Configuracoes.' },
        { status: 400 }
      );
    }

    const prompt = `Você é um roteirista de telejornal. Transforme o seguinte material bruto em um roteiro jornalístico para vídeo com narração em voz alta.

Comprimento do roteiro (obrigatório):
- Duração prevista do vídeo (narração): aproximadamente ${targetVideoDurationSeconds} segundos.
- O roteiro deve ter entre ${wordMin} e ${wordMax} palavras (alvo ~${wordApprox} palavras), proporcional a esse tempo, em ritmo de telejornal claro, sem enrolação nem trechos supérfluos.

${SCRIPT_INSTRUCTIONS}

Material Bruto:
${rawMaterial}

${promptInfo ? `Instruções Adicionais de Tom/Estilo: ${promptInfo}` : ''}`;

    let generatedScript = '';

    if (apiKeys.gemini) {
      const ai = new GoogleGenAI({ apiKey: apiKeys.gemini });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      generatedScript = cleanGeneratedScript(response.text?.trim() || '');
    } else if (apiKeys.openai) {
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKeys.openai}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é um roteirista de telejornal. ${SCRIPT_INSTRUCTIONS}`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!openAiResponse.ok) {
        return NextResponse.json({ error: 'Falha ao gerar roteiro com OpenAI.' }, { status: 502 });
      }

      const openAiData = await openAiResponse.json();
      generatedScript = cleanGeneratedScript(openAiData?.choices?.[0]?.message?.content?.trim() || '');
    }

    if (!generatedScript) {
      return NextResponse.json({ error: 'Resposta vazia do provedor de IA.' }, { status: 502 });
    }

    await adminDb
      .collection('users')
      .doc(uid)
      .collection('projects')
      .doc(projectId)
      .set(
        {
          id: projectId,
          rawMaterial,
          targetVideoDurationSeconds,
          promptInfo,
          generatedScript,
          status: 'script_review',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    return NextResponse.json({ generatedScript });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Falha interna ao gerar roteiro.' }, { status: 500 });
  }
}
