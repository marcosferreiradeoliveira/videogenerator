import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { adminAuth, adminDb, isAdminConfigured } from '@/lib/firebase-admin';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';

type GenerateScriptPayload = {
  projectId?: string;
  rawMaterial: string;
  promptInfo?: string;
  idToken: string;
};

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

    const prompt = `Você é um roteirista de telejornal. Transforme o seguinte material bruto em um roteiro jornalístico para um vídeo de aproximadamente 1 minuto (cerca de 130 a 150 palavras). O texto deve ser direto, claro e pronto para ser lido por um âncora (sem rubricas de cena, apenas o texto falado).

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
      generatedScript = response.text?.trim() || '';
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
              content:
                'Você é um roteirista de telejornal. Responda somente com o roteiro final, sem explicações extras.',
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
      generatedScript = openAiData?.choices?.[0]?.message?.content?.trim() || '';
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
