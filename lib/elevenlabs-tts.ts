export async function synthesizeSpeech(
  apiKey: string,
  voiceId: string,
  text: string
): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `ElevenLabs TTS falhou (HTTP ${res.status}).`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('Audio retornado invalido pela ElevenLabs.');
  return buf;
}
