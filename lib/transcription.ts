export async function transcribeAudio(openAiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Whisper falhou (HTTP ${res.status}).`);
  }

  const transcript = (await res.text()).trim();
  if (!transcript) throw new Error('Transcricao vazia.');
  return transcript;
}
