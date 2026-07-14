'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Languages,
  Loader2,
  Upload,
  Video,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';
import {
  TRANSLATION_LANGUAGES,
  type TranslationLanguageCode,
  type TranslationProject,
} from '@/types';

const CLIP_PRESETS = [
  { value: 0, label: 'Vídeo completo' },
  { value: 15, label: '15 segundos' },
  { value: 30, label: '30 segundos' },
  { value: 45, label: '45 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 90, label: '1 min 30 s' },
  { value: 120, label: '2 minutos' },
];

const PROCESS_STEPS = [
  'Preparando vídeo',
  'Transcrevendo áudio (Whisper)',
  'Traduzindo texto',
  'Gerando narração (ElevenLabs)',
  'Ajustando duração e sincronizando',
  'Finalizando vídeo',
];

type Props = {
  user: User;
};

export function VideoTranslationTab({ user }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguageCode>('en');
  const [clipDurationSeconds, setClipDurationSeconds] = useState(0);
  const [project, setProject] = useState<TranslationProject | null>(null);
  const [history, setHistory] = useState<TranslationProject[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStep, setProcessStep] = useState(0);

  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!firebaseAuth?.currentUser) {
      setHistory([]);
      setIsLoadingHistory(false);
      return;
    }
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch('/api/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data?.error as string) || 'Falha ao carregar historico.');
      }
      setHistory((data.items as TranslationProject[]) || []);
    } catch (e) {
      console.error(e);
      setHistory([]);
      setHistoryError(e instanceof Error ? e.message : 'Falha ao carregar historico.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [user.uid]);

  const handleTranslate = async () => {
    if (!pendingVideo) {
      alert('Selecione um arquivo de vídeo.');
      return;
    }
    if (!firebaseAuth?.currentUser) {
      alert('Sessão expirada. Faça login novamente.');
      return;
    }

    const newProject: TranslationProject = {
      id: Math.random().toString(36).substring(7),
      date: new Date().toISOString(),
      status: 'uploading',
      targetLanguage,
      clipDurationSeconds: clipDurationSeconds > 0 ? clipDurationSeconds : undefined,
    };
    setProject(newProject);
    setIsProcessing(true);
    setProcessStep(0);

    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();

      const uploadForm = new FormData();
      uploadForm.set('projectId', newProject.id);
      uploadForm.set('idToken', idToken);
      uploadForm.set('file', pendingVideo);

      const uploadRes = await fetch('/api/upload-video', { method: 'POST', body: uploadForm });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.sourceVideoUrl) {
        throw new Error((uploadData?.error as string) || 'Falha ao enviar vídeo.');
      }

      const uploadingProject: TranslationProject = {
        ...newProject,
        status: 'processing',
        sourceVideoUrl: uploadData.sourceVideoUrl as string,
      };
      setProject(uploadingProject);

      const stepTimer = window.setInterval(() => {
        setProcessStep((s) => Math.min(s + 1, PROCESS_STEPS.length - 1));
      }, 8000);

      const translateRes = await fetch('/api/translate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: newProject.id,
          targetLanguage,
          clipDurationSeconds: clipDurationSeconds > 0 ? clipDurationSeconds : null,
          idToken,
        }),
      });
      window.clearInterval(stepTimer);

      const translateData = await translateRes.json();
      if (!translateRes.ok || !translateData.outputVideoUrl) {
        throw new Error((translateData?.error as string) || 'Falha ao traduzir vídeo.');
      }

      const completed: TranslationProject = {
        ...uploadingProject,
        status: 'completed',
        outputVideoUrl: translateData.outputVideoUrl as string,
        originalTranscript: translateData.originalTranscript as string,
        translatedTranscript: translateData.translatedTranscript as string,
        sourceDurationSeconds: translateData.sourceDurationSeconds as number,
      };
      setProject(completed);
      setHistory((prev) => {
        const rest = prev.filter((p) => p.id !== completed.id);
        return [completed, ...rest].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      });
      void loadHistory();
      setPendingVideo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Erro na tradução.';
      const errored: TranslationProject = {
        ...newProject,
        status: 'error',
        error: message,
      };
      setProject(errored);
      alert(message);
    } finally {
      setIsProcessing(false);
      setProcessStep(0);
    }
  };

  const langLabel = (code: string) =>
    TRANSLATION_LANGUAGES.find((l) => l.code === code)?.label ?? code;

  return (
    <motion.div
      key="translation"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl space-y-8"
    >
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight flex items-center gap-2">
          <Languages className="w-7 h-7 text-signal" />
          Tradução
        </h2>
        <p className="text-mist mt-1">
          Envie um vídeo, escolha o idioma e receba o mesmo clip com áudio traduzido e sincronizado.
        </p>
      </div>

      <div className="panel p-6 space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foam/85 flex items-center gap-2">
            <Video className="w-4 h-4" />
            Vídeo de origem
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.webm,.mov,.mkv"
            disabled={isProcessing}
            className="text-sm text-foam/85 file:mr-3 file:rounded-lg file:border-0 file:bg-signal/20 file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal hover:file:bg-signal/30"
            onChange={(e) => setPendingVideo(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-mist">MP4, WebM, MOV ou MKV — até 120 MB.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foam/85">Idioma de destino</label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as TranslationLanguageCode)}
              disabled={isProcessing}
              className="input-field"
            >
              {TRANSLATION_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foam/85">Duração a processar</label>
            <select
              value={clipDurationSeconds}
              onChange={(e) => setClipDurationSeconds(Number(e.target.value))}
              disabled={isProcessing}
              className="input-field"
            >
              {CLIP_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-mist">
              Ex.: &quot;30 segundos&quot; usa só o início do vídeo. O áudio traduzido terá exatamente
              essa duração.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-signal/20 bg-signal/5 p-4 text-sm text-foam space-y-1">
          <p className="font-medium">Requisitos (Config)</p>
          <ul className="list-disc list-inside text-mist text-xs space-y-0.5">
            <li>OpenAI — transcrição (Whisper)</li>
            <li>Gemini ou OpenAI — tradução do texto</li>
            <li>ElevenLabs + Voice ID — narração no idioma escolhido</li>
          </ul>
        </div>

        <button
          type="button"
          onClick={handleTranslate}
          disabled={isProcessing || !pendingVideo}
          className="btn-primary w-full py-4"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processando…
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              Traduzir e sincronizar vídeo
            </>
          )}
        </button>

        {isProcessing && (
          <div className="rounded-xl border border-line bg-ink-2 p-4 space-y-3">
            <p className="text-sm font-medium text-foam">{PROCESS_STEPS[processStep]}…</p>
            <div className="h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-signal transition-all duration-500"
                style={{ width: `${((processStep + 1) / PROCESS_STEPS.length) * 100}%` }}
              />
            </div>
            <p className="text-xs text-mist">
              Pode levar alguns minutos conforme a duração do trecho.
            </p>
          </div>
        )}
      </div>

      {project?.status === 'completed' && project.outputVideoUrl && (
        <div className="bg-panel p-6 rounded-2xl border border-ok/30 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-ok font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            Vídeo traduzido pronto
          </div>
          <video
            src={project.outputVideoUrl}
            controls
            className="w-full rounded-xl bg-black aspect-video"
          />
          <a
            href={project.outputVideoUrl}
            download
            className="inline-flex text-sm text-signal hover:text-signal font-medium"
          >
            Baixar vídeo traduzido
          </a>
          {project.translatedTranscript && (
            <div className="space-y-2 pt-2 border-t border-line-soft">
              <p className="text-xs font-semibold uppercase tracking-wide text-mist">
                Texto traduzido ({langLabel(project.targetLanguage)})
              </p>
              <p className="text-sm text-foam/85 whitespace-pre-wrap bg-ink-2 p-3 rounded-lg">
                {project.translatedTranscript}
              </p>
            </div>
          )}
        </div>
      )}

      {project?.status === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-warm/30 bg-warm/10 p-4 text-sm text-warm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{project.error || 'Erro na tradução.'}</span>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foam">Histórico de traduções</h3>
        {isLoadingHistory ? (
          <div className="flex items-center gap-2 text-mist text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando…
          </div>
        ) : historyError ? (
          <p className="text-sm text-warn bg-warn/10 border border-warn/30 rounded-lg p-3">
            {historyError}
          </p>
        ) : history.length === 0 ? (
          <p className="text-sm text-mist">Nenhuma tradução ainda.</p>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className="bg-panel p-4 rounded-xl border border-line text-sm space-y-2"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{langLabel(item.targetLanguage)}</span>
                <span className="text-xs text-mist">
                  {new Date(item.date).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="text-xs text-mist">
                {item.clipDurationSeconds
                  ? `${item.clipDurationSeconds}s do início`
                  : 'Vídeo completo'}
                {item.sourceDurationSeconds
                  ? ` · áudio ${item.sourceDurationSeconds.toFixed(1)}s`
                  : ''}
              </p>
              {item.outputVideoUrl && (
                <a
                  href={item.outputVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal hover:text-signal text-xs"
                >
                  Abrir vídeo traduzido
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
