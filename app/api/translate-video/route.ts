import { NextResponse } from 'next/server';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  adminAuth,
  adminDb,
  describeStorageFailure,
  getAdminStorageBucket,
  getResolvedStorageBucketName,
  isAdminConfigured,
} from '@/lib/firebase-admin';
import { sanitizeApiKeysDoc } from '@/lib/sanitize-api-keys';
import { synthesizeSpeech } from '@/lib/elevenlabs-tts';
import {
  cleanupWorkDir,
  extractAudio,
  getMediaDurationSeconds,
  matchAudioDuration,
  muxVideoWithAudio,
  trimVideo,
} from '@/lib/ffmpeg';
import { transcribeAudio } from '@/lib/transcription';
import { translateTranscript } from '@/lib/translate-text';

export const runtime = 'nodejs';
export const maxDuration = 300;

type TranslateVideoPayload = {
  projectId?: string;
  targetLanguage?: string;
  clipDurationSeconds?: number | null;
  idToken?: string;
};

function clampClipSeconds(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(600, Math.round(n));
}

export async function POST(request: Request) {
  if (!isAdminConfigured || !adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin nao configurado no servidor.' }, { status: 500 });
  }
  const bucket = getAdminStorageBucket();
  const bucketName = getResolvedStorageBucketName();
  if (!bucket || !bucketName) {
    return NextResponse.json({ error: 'Firebase Storage nao configurado.' }, { status: 500 });
  }

  let workDir = '';
  let errorProjectId = '';
  let errorUid = '';

  try {
    const body = (await request.json()) as TranslateVideoPayload;
    const projectId = body.projectId?.trim();
    const targetLanguage = body.targetLanguage?.trim();
    const clipDurationSeconds = clampClipSeconds(body.clipDurationSeconds);
    const idToken = body.idToken?.trim();

    if (!projectId || !targetLanguage || !idToken) {
      return NextResponse.json({ error: 'projectId, targetLanguage e idToken sao obrigatorios.' }, { status: 400 });
    }

    const { uid } = await adminAuth.verifyIdToken(idToken);
    errorProjectId = projectId;
    errorUid = uid;
    const keysSnapshot = await adminDb.collection('users').doc(uid).collection('settings').doc('apiKeys').get();
    const apiKeys = sanitizeApiKeysDoc(keysSnapshot.data());

    if (!apiKeys.openai) {
      return NextResponse.json(
        { error: 'Configure a chave OpenAI em Configuracoes (necessaria para transcrever o audio com Whisper).' },
        { status: 400 }
      );
    }
    if (!apiKeys.elevenlabs) {
      return NextResponse.json({ error: 'Configure a chave ElevenLabs em Configuracoes.' }, { status: 400 });
    }
    const voiceId =
      apiKeys.elevenlabsVoiceId?.trim() || process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim() || '';
    if (!voiceId) {
      return NextResponse.json({ error: 'Defina o ElevenLabs Voice ID em Configuracoes.' }, { status: 400 });
    }
    if (!apiKeys.gemini && !apiKeys.openai) {
      return NextResponse.json({ error: 'Configure Gemini ou OpenAI para traducao.' }, { status: 400 });
    }

    const docRef = adminDb.collection('users').doc(uid).collection('translations').doc(projectId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: 'Envie o video antes de traduzir.' }, { status: 400 });
    }

    const now = new Date().toISOString();
    await docRef.set(
      { status: 'processing', targetLanguage, clipDurationSeconds: clipDurationSeconds ?? null, updatedAt: now },
      { merge: true }
    );

    const prefix = `users/${uid}/translations/${projectId}/`;
    const [files] = await bucket.getFiles({ prefix });
    const sourceFile = files.find((f) => f.name.includes('/source.'));
    if (!sourceFile) {
      return NextResponse.json({ error: 'Video fonte nao encontrado no Storage.' }, { status: 400 });
    }

    workDir = await mkdtemp(join(tmpdir(), 'newsgen-tr-'));
    const sourceExt = sourceFile.name.split('.').pop() || 'mp4';
    const sourcePath = join(workDir, `source.${sourceExt}`);
    const trimmedPath = join(workDir, 'trimmed.mp4');
    const audioPath = join(workDir, 'original.mp3');
    const ttsPath = join(workDir, 'tts.mp3');
    const syncedPath = join(workDir, 'synced.mp3');
    const outputPath = join(workDir, 'output.mp4');

    const [sourceBuffer] = await sourceFile.download();
    await writeFile(sourcePath, sourceBuffer);

    let videoForMux = sourcePath;
    if (clipDurationSeconds) {
      await trimVideo(sourcePath, trimmedPath, clipDurationSeconds);
      videoForMux = trimmedPath;
    }

    await extractAudio(videoForMux, audioPath);
    const targetDuration = await getMediaDurationSeconds(audioPath);

    const audioBuffer = await readFile(audioPath);
    const originalTranscript = await transcribeAudio(apiKeys.openai, audioBuffer, 'audio.mp3');
    const translatedTranscript = await translateTranscript(originalTranscript, targetLanguage, {
      gemini: apiKeys.gemini,
      openai: apiKeys.openai,
    });

    const ttsBuffer = await synthesizeSpeech(apiKeys.elevenlabs, voiceId, translatedTranscript);
    await writeFile(ttsPath, ttsBuffer);
    await matchAudioDuration(ttsPath, syncedPath, targetDuration);
    await muxVideoWithAudio(videoForMux, syncedPath, outputPath);

    const outputBuffer = await readFile(outputPath);
    const outputStoragePath = `${prefix}output.mp4`;
    const outFile = bucket.file(outputStoragePath);
    await outFile.save(outputBuffer, {
      resumable: false,
      contentType: 'video/mp4',
      public: false,
      metadata: { cacheControl: 'public,max-age=3600' },
    });
    const [outputVideoUrl] = await outFile.getSignedUrl({ action: 'read', expires: '2100-01-01' });

    await docRef.set(
      {
        id: projectId,
        status: 'completed',
        targetLanguage,
        clipDurationSeconds: clipDurationSeconds ?? null,
        sourceDurationSeconds: targetDuration,
        originalTranscript,
        translatedTranscript,
        outputVideoUrl,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      outputVideoUrl,
      originalTranscript,
      translatedTranscript,
      sourceDurationSeconds: targetDuration,
    });
  } catch (error) {
    console.error('translate-video', error);
    if (errorProjectId && errorUid && adminDb) {
      try {
        await adminDb
          .collection('users')
          .doc(errorUid)
          .collection('translations')
          .doc(errorProjectId)
          .set(
            {
              status: 'error',
              error: error instanceof Error ? error.message : 'Falha na traducao.',
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
      } catch {
        // ignore secondary failure
      }
    }
    const message = error instanceof Error ? error.message : 'Falha interna na traducao.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
