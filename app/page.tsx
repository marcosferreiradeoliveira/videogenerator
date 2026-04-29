'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import heroVisual from '@/lib/assets/imagem.jpeg';
import { 
  Settings, 
  Video, 
  Mic, 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Upload,
  DollarSign,
  Key,
  FileText,
  Sparkles,
  ArrowLeft,
  Check,
  LogOut,
  HelpCircle,
  X,
  Library
} from 'lucide-react';
import { ApiKeys, GenerationCost, VideoProject } from '@/types';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseDb, isFirebaseConfigured } from '@/lib/firebase';

const INITIAL_KEYS: ApiKeys = {
  gemini: '',
  elevenlabs: '',
  elevenlabsVoiceId: '',
  heygen: '',
  heygenCharacterId: '',
  heygenCharacterKind: 'avatar',
  kling: '',
  openai: '',
};

const VIDEO_DURATION_PRESETS: { value: number; label: string }[] = [
  { value: 30, label: '30 segundos' },
  { value: 45, label: '45 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 90, label: '1 minuto e 30 segundos' },
  { value: 120, label: '2 minutos' },
  { value: 180, label: '3 minutos' },
];

const isProdBuild = process.env.NODE_ENV === 'production';

function dedupeByAvatarId(items: { avatar_id: string; avatar_name: string }[]) {
  const seen = new Set<string>();
  return items.filter((a) => {
    const id = a.avatar_id?.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const KEY_HELP_CONTENT: Record<keyof ApiKeys, { title: string; steps: string[]; link: string }> = {
  gemini: {
    title: 'Como obter Gemini API Key',
    steps: [
      'Acesse o Google AI Studio.',
      'Entre com sua conta Google.',
      'Abra a opcao "Get API key" no menu.',
      'Crie uma nova chave e copie o valor para este campo.',
    ],
    link: 'https://aistudio.google.com/apikey',
  },
  openai: {
    title: 'Como obter OpenAI API Key',
    steps: [
      'Acesse o painel da OpenAI.',
      'Entre na area "API keys".',
      'Clique em "Create new secret key".',
      'Copie e cole a chave (ela aparece uma vez).',
    ],
    link: 'https://platform.openai.com/api-keys',
  },
  elevenlabs: {
    title: 'Como obter ElevenLabs API Key',
    steps: [
      'Acesse o dashboard da ElevenLabs.',
      'Abra seu perfil e entre em "API Keys".',
      'Crie uma nova chave.',
      'Copie a chave e cole no campo.',
    ],
    link: 'https://elevenlabs.io/app/settings/api-keys',
  },
  elevenlabsVoiceId: {
    title: 'Como obter ElevenLabs Voice ID',
    steps: [
      'O campo e obrigatorio: a API precisa de um voice_id valido.',
      'No plano gratuito, vozes da Voice Library (incluindo vozes “padrao” como Rachel) costumam ser bloqueadas na API.',
      'Em ElevenLabs, use vozes listadas em “My Voices” / vozes da sua conta e copie o voice_id.',
      'Com plano pago, voce pode usar mais vozes; em deploy proprio, opcionalmente defina ELEVENLABS_DEFAULT_VOICE_ID no servidor.',
    ],
    link: 'https://elevenlabs.io/app/voice-library',
  },
  heygen: {
    title: 'Como obter HeyGen API Key',
    steps: [
      'Acesse a conta HeyGen.',
      'Vá para Settings/Developers.',
      'Abra a secao de API keys.',
      'Gere uma chave e copie para este campo.',
    ],
    link: 'https://app.heygen.com/settings?tab=api',
  },
  heygenCharacterId: {
    title: 'HeyGen — ID do personagem',
    steps: [
      'Em Configurações, clique em "Carregar personagens HeyGen" (com a API key preenchida).',
      'Escolha um avatar na lista ou cole manualmente um avatar_id da API List Avatars V2.',
      'Use apenas Avatar (nao Talking Photo) para melhor resultado neste app.',
    ],
    link: 'https://docs.heygen.com/reference/list-avatars-v2',
  },
  heygenCharacterKind: {
    title: 'Tipo de personagem HeyGen',
    steps: [
      'Este app esta configurado para usar apenas Avatar.',
      'Se estava em Talking Photo, altere para Avatar e use um avatar_id.',
    ],
    link: 'https://docs.heygen.com/docs/create-videos-with-avatars',
  },
  kling: {
    title: 'Como obter Kling API Key',
    steps: [
      'Acesse o console da plataforma Kling.',
      'Entre em Developers/API.',
      'Crie uma chave de API.',
      'Copie e cole aqui.',
    ],
    link: 'https://klingai.com/',
  },
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<'generator' | 'settings' | 'content'>('generator');
  const [apiKeys, setApiKeys] = useState<ApiKeys>(INITIAL_KEYS);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isKeysLoading, setIsKeysLoading] = useState(true);
  const [savedProjects, setSavedProjects] = useState<VideoProject[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [helpModalKey, setHelpModalKey] = useState<keyof ApiKeys | null>(null);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<{ voice_id: string; name: string }[]>([]);
  const [elevenLabsVoicesLoading, setElevenLabsVoicesLoading] = useState(false);
  const [elevenLabsVoicesError, setElevenLabsVoicesError] = useState<string | null>(null);
  const [elevenLabsMissingVoicesRead, setElevenLabsMissingVoicesRead] = useState(false);
  const [heygenAvatars, setHeygenAvatars] = useState<{ avatar_id: string; avatar_name: string }[]>([]);
  const [heygenListLoading, setHeygenListLoading] = useState(false);
  const [heygenListError, setHeygenListError] = useState<string | null>(null);

  // Generator State
  const [rawMaterial, setRawMaterial] = useState('');
  const [targetVideoDurationSeconds, setTargetVideoDurationSeconds] = useState(60);
  const [editableScript, setEditableScript] = useState('');
  /** Instruções extras para o vídeo (HeyGen), preenchidas na revisão de áudio. */
  const [videoPromptInfo, setVideoPromptInfo] = useState('');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<VideoProject['status']>('idle');
  const [project, setProject] = useState<VideoProject | null>(null);
  const testAudioInputRef = useRef<HTMLInputElement>(null);
  const [pendingTestAudio, setPendingTestAudio] = useState<File | null>(null);
  const [isUploadingTestAudio, setIsUploadingTestAudio] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) {
      setIsAuthLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        console.warn(
          '[NewsGen] Firebase Auth demorou a responder; a verificacao de sessao foi interrompida. Verifique rede, bloqueadores e dominios autorizados no Firebase Console.'
        );
        setIsAuthLoading(false);
      }
    }, 12000);

    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      setUser(currentUser);
      setIsAuthLoading(false);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadKeysFromFirestore = async () => {
      if (!firebaseDb || !user) {
        setApiKeys(INITIAL_KEYS);
        setIsKeysLoading(false);
        return;
      }

      setIsKeysLoading(true);
      try {
        const keysDocRef = doc(firebaseDb, 'users', user.uid, 'settings', 'apiKeys');
        const snapshot = await getDoc(keysDocRef);
        if (snapshot.exists()) {
          setApiKeys({ ...INITIAL_KEYS, ...(snapshot.data() as Partial<ApiKeys>) });
        } else {
          setApiKeys(INITIAL_KEYS);
        }
      } catch (error) {
        console.error(error);
        alert('Falha ao carregar chaves salvas no Firebase.');
      } finally {
        setIsKeysLoading(false);
      }
    };

    loadKeysFromFirestore();
  }, [user]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!firebaseDb || !user) {
        setSavedProjects([]);
        setIsProjectsLoading(false);
        return;
      }

      setIsProjectsLoading(true);
      try {
        const projectsRef = collection(firebaseDb, 'users', user.uid, 'projects');
        const projectsQuery = query(projectsRef, orderBy('date', 'desc'));
        const snapshot = await getDocs(projectsQuery);
        const items = snapshot.docs.map((projectDoc) => ({
          ...(projectDoc.data() as VideoProject),
          id: projectDoc.id,
        }));
        setSavedProjects(items);
      } catch (error) {
        console.error(error);
        const maybeFirebaseError = error as { code?: string };
        if (maybeFirebaseError?.code === 'permission-denied') {
          alert(
            'Sem permissao para ler historico. Publique as regras do Firestore e confirme que voce esta logado com o mesmo usuario dono dos dados.'
          );
        } else {
          alert('Falha ao carregar conteúdos gerados.');
        }
      } finally {
        setIsProjectsLoading(false);
      }
    };

    loadProjects();
  }, [user]);

  useEffect(() => {
    if (project?.id) {
      setVideoPromptInfo(project.promptInfo ?? '');
    }
  }, [project?.id]);

  useEffect(() => {
    if (currentStep !== 'script_review' || !apiKeys.elevenlabs || !firebaseAuth?.currentUser) {
      return;
    }
    const authUser = firebaseAuth.currentUser;

    let cancelled = false;
    const loadVoices = async () => {
      setElevenLabsVoicesLoading(true);
      setElevenLabsVoicesError(null);
      setElevenLabsMissingVoicesRead(false);
      try {
        const idToken = await authUser.getIdToken();
        const res = await fetch('/api/elevenlabs-voices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setElevenLabsVoices([]);
            setElevenLabsVoicesError(data?.error || 'Falha ao listar vozes.');
            setElevenLabsMissingVoicesRead(data?.code === 'missing_voices_read');
          }
          return;
        }
        if (!cancelled) setElevenLabsVoices(data.voices || []);
      } catch (e) {
        if (!cancelled) {
          setElevenLabsVoicesError(e instanceof Error ? e.message : 'Erro ao carregar vozes.');
          setElevenLabsVoices([]);
        }
      } finally {
        if (!cancelled) setElevenLabsVoicesLoading(false);
      }
    };

    loadVoices();
    return () => {
      cancelled = true;
    };
  }, [currentStep, apiKeys.elevenlabs, user]);

  const persistProject = async (projectData: VideoProject) => {
    if (!firebaseDb || !user) return;
    try {
      const projectRef = doc(firebaseDb, 'users', user.uid, 'projects', projectData.id);
      await setDoc(projectRef, projectData, { merge: true });
      setSavedProjects((prev) => {
        const withoutCurrent = prev.filter((item) => item.id !== projectData.id);
        return [projectData, ...withoutCurrent].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      });
    } catch (error) {
      console.error(error);
      alert('Falha ao salvar conteúdo no Firebase.');
    }
  };

  const updateApiKey = async (field: keyof ApiKeys, value: string) => {
    const nextKeys = { ...apiKeys, [field]: value };
    setApiKeys(nextKeys);

    if (!firebaseDb || !user) return;

    try {
      const keysDocRef = doc(firebaseDb, 'users', user.uid, 'settings', 'apiKeys');
      // Sem merge: substitui o documento inteiro. Com merge, campos antigos/extras
      // ficariam no doc e quebrariam validacao hasOnly() nas Firestore Rules.
      await setDoc(keysDocRef, nextKeys);
    } catch (error) {
      console.error(error);
      const code = (error as { code?: string }).code;
      if (code === 'permission-denied') {
        alert(
          'Sem permissao para salvar chaves. Publique as regras atuais do Firestore (firestore.rules) no projeto Firebase, ou remova campos extras no documento users/seu_uid/settings/apiKeys no console.'
        );
      } else {
        alert('Falha ao salvar chave no Firebase.');
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (!firebaseAuth) {
      alert(
        isProdBuild
          ? 'Firebase (cliente) nao configurado neste deploy. No Firebase Console: App Hosting → o teu backend → Environment — adiciona NEXT_PUBLIC_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID e APP_ID (Project settings → teu app web). Grava e faz um novo deploy para o build incluir estas variaveis.'
          : 'Firebase nao configurado. Cria .env.local na raiz com NEXT_PUBLIC_FIREBASE_* e reinicia npm run dev.'
      );
      return;
    }
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      console.error(error);
      alert('Falha no login com Google. Tente novamente.');
    }
  };

  const handleSignOut = async () => {
    if (!firebaseAuth) return;
    try {
      await signOut(firebaseAuth);
      setCurrentStep('idle');
      setProject(null);
      setEditableScript('');
      setApiKeys(INITIAL_KEYS);
      setSavedProjects([]);
    } catch (error) {
      console.error(error);
      alert('Falha ao sair da conta.');
    }
  };

  const handleGenerateScript = async () => {
    if (!rawMaterial) {
      alert('Por favor, insira o material bruto da reportagem.');
      return;
    }
    setIsGenerating(true);
    setCurrentStep('generating_script');
    setVideoPromptInfo('');

    const newProject: VideoProject = {
      id: Math.random().toString(36).substring(7),
      date: new Date().toISOString(),
      rawMaterial,
      targetVideoDurationSeconds,
      status: 'generating_script',
    };
    setProject(newProject);
    await persistProject(newProject);

    try {
      if (!firebaseAuth?.currentUser) {
        throw new Error('Usuario nao autenticado.');
      }

      const idToken = await firebaseAuth.currentUser.getIdToken();
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: newProject.id,
          rawMaterial,
          promptInfo: '',
          targetVideoDurationSeconds,
          idToken,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.generatedScript) {
        const backendError = data?.error || 'Falha ao gerar roteiro.';
        if (backendError.includes('Firebase Admin nao configurado')) {
          alert(
            isProdBuild
              ? 'Firebase Admin nao configurado no servidor. No App Hosting → Environment/Secrets usa SERVICE_ACCOUNT_PROJECT_ID, SERVICE_ACCOUNT_CLIENT_EMAIL, SERVICE_ACCOUNT_PRIVATE_KEY (nomes FIREBASE_* sao reservados) e SERVICE_ACCOUNT_STORAGE_BUCKET ou NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET. Depois redeploy.'
              : 'Backend nao configurado para IA segura. Defina FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL e FIREBASE_ADMIN_PRIVATE_KEY no .env.local e reinicie o npm run dev.'
          );
        }
        throw new Error(backendError);
      }
      const generatedScript = data.generatedScript as string;
      const updatedProject: VideoProject = {
        ...newProject,
        generatedScript,
        status: 'script_review',
      };
      
      setEditableScript(generatedScript);
      setProject(updatedProject);
      await persistProject(updatedProject);
      setCurrentStep('script_review');

    } catch (error) {
      console.error(error);
      setCurrentStep('error');
      const erroredProject = newProject
        ? { ...newProject, status: 'error' as const, error: 'Falha na geração do roteiro.' }
        : null;
      setProject(erroredProject);
      if (erroredProject) await persistProject(erroredProject);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!apiKeys.elevenlabs) {
      alert('Por favor, configure sua chave da ElevenLabs nas configurações primeiro.');
      setActiveTab('settings');
      return;
    }
    if (!apiKeys.elevenlabsVoiceId?.trim()) {
      alert(
        'Defina o ElevenLabs Voice ID (voz da sua conta em “My Voices”, não da Voice Library). No plano gratuito, vozes de biblioteca são bloqueadas na API.'
      );
      return;
    }
    if (!project) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }

    setIsGenerating(true);
    setCurrentStep('generating_audio');
    const baseProject = { ...project };
    const generatingAudioProject: VideoProject = {
      ...baseProject,
      status: 'generating_audio',
      generatedScript: editableScript,
    };
    setProject(generatingAudioProject);
    await persistProject(generatingAudioProject);

    try {
      if (!firebaseAuth?.currentUser) {
        throw new Error('Usuario nao autenticado.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const response = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: baseProject.id,
          script: editableScript,
          idToken,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.audioUrl) {
        const msg = (data?.error as string) || 'Falha ao gerar audio.';
        alert(msg);
        throw new Error(msg);
      }

      const audioReviewProject: VideoProject = {
        ...baseProject,
        generatedScript: editableScript,
        status: 'audio_review',
        audioUrl: data.audioUrl as string,
        cost: data.cost,
      };
      setProject(audioReviewProject);
      await persistProject(audioReviewProject);
      setCurrentStep('audio_review');

    } catch (error) {
      console.error(error);
      setCurrentStep('error');
      const erroredProject: VideoProject = {
        ...baseProject,
        status: 'error',
        error: error instanceof Error ? error.message : 'Falha na geração do áudio.',
      };
      setProject(erroredProject);
      await persistProject(erroredProject);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUploadTestAudio = async () => {
    if (!pendingTestAudio) {
      alert('Selecione um arquivo de áudio.');
      return;
    }
    if (!project) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }

    setIsGenerating(true);
    setIsUploadingTestAudio(true);
    setCurrentStep('generating_audio');
    const baseProject = { ...project };
    const generatingAudioProject: VideoProject = {
      ...baseProject,
      status: 'generating_audio',
      generatedScript: editableScript,
    };
    setProject(generatingAudioProject);
    await persistProject(generatingAudioProject);

    try {
      if (!firebaseAuth?.currentUser) {
        throw new Error('Usuario nao autenticado.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const formData = new FormData();
      formData.set('projectId', baseProject.id);
      formData.set('script', editableScript);
      formData.set('idToken', idToken);
      formData.set('file', pendingTestAudio);

      const response = await fetch('/api/upload-audio', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok || !data.audioUrl) {
        const msg = (data?.error as string) || 'Falha ao enviar audio.';
        alert(msg);
        throw new Error(msg);
      }

      const audioReviewProject: VideoProject = {
        ...baseProject,
        generatedScript: editableScript,
        status: 'audio_review',
        audioUrl: data.audioUrl as string,
        cost: data.cost as GenerationCost,
      };
      setProject(audioReviewProject);
      await persistProject(audioReviewProject);
      setCurrentStep('audio_review');
      setPendingTestAudio(null);
      if (testAudioInputRef.current) testAudioInputRef.current.value = '';
    } catch (error) {
      console.error(error);
      setCurrentStep('error');
      const erroredProject: VideoProject = {
        ...baseProject,
        status: 'error',
        error: error instanceof Error ? error.message : 'Falha no envio do áudio.',
      };
      setProject(erroredProject);
      await persistProject(erroredProject);
    } finally {
      setIsUploadingTestAudio(false);
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!project) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }
    if (!project.cost) {
      alert('Custo de áudio não encontrado. Gere o áudio novamente.');
      setCurrentStep('script_review');
      return;
    }
    if (!project.audioUrl) {
      alert('É necessário ter áudio no projeto antes de gerar o vídeo.');
      return;
    }
    if (!apiKeys.heygen?.trim()) {
      alert('Configure a API Key do HeyGen em Configurações.');
      setActiveTab('settings');
      return;
    }
    if (!apiKeys.heygenCharacterId?.trim()) {
      alert('Escolha ou cole o ID do personagem HeyGen (avatar ou talking photo) em Configurações.');
      setActiveTab('settings');
      return;
    }

    setIsGenerating(true);
    setCurrentStep('generating_video');
    const videoNotesTrim = videoPromptInfo.trim();
    const baseProject: VideoProject = {
      ...project,
      ...(videoNotesTrim ? { promptInfo: videoNotesTrim } : {}),
    };
    const generatingVideoProject: VideoProject = { ...baseProject, status: 'generating_video' };
    setProject(generatingVideoProject);
    await persistProject(generatingVideoProject);

    const fail = async (message: string) => {
      setCurrentStep('error');
      const erroredProject: VideoProject = {
        ...baseProject,
        status: 'error',
        error: message,
      };
      setProject(erroredProject);
      await persistProject(erroredProject);
    };

    try {
      if (!firebaseAuth?.currentUser) {
        throw new Error('Usuario nao autenticado.');
      }
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: baseProject.id,
          script: editableScript,
          currentAudioCost: baseProject.cost?.audioCost || 0,
          videoNotes: videoNotesTrim,
          idToken,
        }),
      });

      const start = await response.json();
      if (!response.ok || !start.heygenVideoId) {
        throw new Error((start?.error as string) || 'Falha ao iniciar vídeo no HeyGen.');
      }

      const queuedProject: VideoProject = {
        ...baseProject,
        status: 'generating_video',
        heygenVideoId: start.heygenVideoId as string,
        videoIsDemo: false,
      };
      setProject(queuedProject);
      await persistProject(queuedProject);

      const maxPolls = 120;
      const intervalMs = 4000;

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const pollRes = await fetch('/api/heygen-poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: baseProject.id,
            idToken: await firebaseAuth.currentUser.getIdToken(),
          }),
        });
        const pollData = await pollRes.json();

        if (pollData.status === 'completed' && pollData.videoUrl) {
          const completedProject: VideoProject = {
            ...baseProject,
            status: 'completed',
            heygenVideoId: start.heygenVideoId as string,
            cost: {
              ...baseProject.cost!,
              videoSeconds: pollData.videoSeconds as number,
              videoCost: pollData.videoCost as number,
              totalCost: pollData.totalCost as number,
            },
            videoUrl: pollData.videoUrl as string,
            videoIsDemo: false,
          };
          setProject(completedProject);
          await persistProject(completedProject);
          setCurrentStep('completed');
          return;
        }

        if (!pollRes.ok || pollData.status === 'failed') {
          throw new Error((pollData.error as string) || 'Render HeyGen falhou.');
        }
      }

      throw new Error(
        'Tempo esgotado a aguardar o HeyGen (pode levar vários minutos). Abra o projeto mais tarde ou tente de novo.'
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Falha na geração do vídeo.';
      alert(message);
      await fail(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const loadHeygenCharacters = async () => {
    if (!apiKeys.heygen?.trim()) {
      alert('Preencha a API Key do HeyGen primeiro.');
      return;
    }
    if (!firebaseAuth?.currentUser) return;
    setHeygenListLoading(true);
    setHeygenListError(null);
    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch('/api/heygen-avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Falha ao listar personagens.');
      }
      setHeygenAvatars(dedupeByAvatarId(data.avatars || []));
    } catch (e) {
      setHeygenListError(e instanceof Error ? e.message : 'Erro ao carregar HeyGen.');
      setHeygenAvatars([]);
    } finally {
      setHeygenListLoading(false);
    }
  };

  const applyHeygenCharacterPick = (value: string) => {
    if (!value) return;
    const colon = value.indexOf(':');
    if (colon < 1) return;
    const cid = value.slice(colon + 1);
    setApiKeys((prev) => {
      const next: ApiKeys = { ...prev, heygenCharacterKind: 'avatar', heygenCharacterId: cid };
      if (firebaseDb && user) {
        void setDoc(doc(firebaseDb, 'users', user.uid, 'settings', 'apiKeys'), next).catch((err) => {
          console.error(err);
          alert('Falha ao gravar personagem HeyGen.');
        });
      }
      return next;
    });
  };

  const heygenPickSelectValue =
    apiKeys.heygenCharacterId.trim() !== '' ? `avatar:${apiKeys.heygenCharacterId}` : '';

  const handleReset = () => {
    setCurrentStep('idle');
    setProject(null);
    setEditableScript('');
    setVideoPromptInfo('');
  };

  const elevenLabsVoiceSelectValue = (() => {
    if (elevenLabsVoices.some((v) => v.voice_id === apiKeys.elevenlabsVoiceId)) {
      return apiKeys.elevenlabsVoiceId;
    }
    return '__pick__';
  })();

  const handleElevenLabsVoiceSelect = (value: string) => {
    if (value === '__pick__') return;
    updateApiKey('elevenlabsVoiceId', value);
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-indigo-100/90">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-300" />
          <span className="text-sm font-medium tracking-wide">A verificar sessão…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white overflow-x-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl"
            aria-hidden
          />
          <div
            className="absolute bottom-0 left-1/4 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl"
            aria-hidden
          />
        </div>

        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
          <div className="flex flex-1 flex-col justify-center px-6 pb-10 pt-14 sm:px-10 lg:px-14 lg:py-16 lg:pr-8">
            <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-wider text-indigo-200/90 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Estúdio de vídeo com IA
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-[2.75rem]">
              NewsGen AI
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-indigo-100/85">
              Uma ferramenta para jornalistas e criadores: cola o <strong className="font-semibold text-white">material
              bruto</strong> da notícia e obténs um <strong className="font-semibold text-white">roteiro</strong> pronto
              para âncora, <strong className="font-semibold text-white">voz sintética</strong> natural (ElevenLabs) e um{' '}
              <strong className="font-semibold text-white">vídeo com avatar</strong> (HeyGen) — tudo guardado na tua
              conta.
            </p>

            <ul className="mt-8 space-y-4 max-w-lg">
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                  <FileText className="h-4 w-4 text-indigo-200" />
                </span>
                <div>
                  <p className="font-medium text-white">Roteiro com Gemini ou OpenAI</p>
                  <p className="text-sm text-indigo-200/75">
                    A IA condensa factos e notas num texto de cerca de um minuto, com tom de telejornal.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                  <Mic className="h-4 w-4 text-indigo-200" />
                </span>
                <div>
                  <p className="font-medium text-white">Narração em áudio</p>
                  <p className="text-sm text-indigo-200/75">
                    Escolhes a voz; o servidor gera o áudio e podes ouvir antes de avançar.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                  <Video className="h-4 w-4 text-indigo-200" />
                </span>
                <div>
                  <p className="font-medium text-white">Vídeo com apresentador virtual</p>
                  <p className="text-sm text-indigo-200/75">
                    O HeyGen sincroniza o teu áudio com um avatar — ideal para peças rápidas para redes ou interno.
                  </p>
                </div>
              </li>
            </ul>

            <div className="mt-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl backdrop-blur-md">
              <p className="text-sm text-indigo-100/90">
                {isFirebaseConfigured
                  ? 'Inicia sessão com Google para guardar projetos e chaves de API de forma privada no Firebase.'
                  : isProdBuild
                    ? 'As variáveis públicas do Firebase não estão neste build — configura-as no painel de hospedagem (ver abaixo).'
                    : 'Configura o Firebase no projeto para ativar o login e a base de dados.'}
              </p>
              {isFirebaseConfigured ? (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="mt-5 w-full rounded-xl bg-white py-3.5 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-indigo-50"
                >
                  Entrar com Google
                </button>
              ) : isProdBuild ? (
                <div className="mt-5 space-y-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-50">
                  <p>
                    No{' '}
                    <a
                      href="https://console.firebase.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white underline decoration-amber-300/80 underline-offset-2 hover:text-amber-100"
                    >
                      Firebase Console
                    </a>
                    : <strong className="text-white">App Hosting</strong> → o teu backend →{' '}
                    <strong className="text-white">Environment</strong>. Adiciona as seis variáveis do teu app web (
                    <em className="text-amber-100/90">Project settings</em>
                    {` → General → Your apps → SDK setup and configuration): `}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_API_KEY</code>,{' '}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN</code>,{' '}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_PROJECT_ID</code>,{' '}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET</code>,{' '}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID</code>,{' '}
                    <code className="rounded bg-black/25 px-1 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_APP_ID</code>.
                  </p>
                  <p className="text-amber-100/95">
                    Grava as alterações e corre <strong className="text-white">novo deploy</strong> (as{' '}
                    <code className="rounded bg-black/25 px-1 text-xs">NEXT_PUBLIC_*</code> entram no bundle na altura do
                    build).
                  </p>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Cria <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">.env.local</code> na raiz com{' '}
                  <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_FIREBASE_*</code> e reinicia{' '}
                  <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">npm run dev</code>.
                </div>
              )}
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center px-6 pb-16 pt-4 sm:px-10 lg:px-14 lg:py-16 lg:pl-4">
            <div className="relative w-full max-w-xl">
              <div
                className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-indigo-500/40 via-transparent to-cyan-400/20 blur-2xl"
                aria-hidden
              />
              <div className="relative overflow-hidden rounded-[1.75rem] shadow-2xl ring-1 ring-white/15">
                <div className="relative aspect-[4/3] w-full sm:aspect-[16/11]">
                  <Image
                    src={heroVisual}
                    alt="Ambiente de estúdio e ecrãs — ilustração do NewsGen AI"
                    fill
                    priority
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
                    <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200/90">Do texto ao vídeo</p>
                    <p className="mt-1 max-w-sm text-sm leading-relaxed text-white/95">
                      Fluxo guiado: material → roteiro → áudio → vídeo final, com histórico nos Conteúdos gerados.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-neutral-200 p-6 flex flex-col gap-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 text-indigo-600">
            <Video className="w-6 h-6" />
            NewsGen AI
          </h1>
          <p className="text-xs text-neutral-500 mt-1">Automated Video Workflows</p>
        </div>

        <nav className="flex flex-col gap-2">
          <button
            onClick={() => setActiveTab('generator')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'generator' 
                ? 'bg-indigo-50 text-indigo-700' 
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <Play className="w-4 h-4" />
            Gerador
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'settings' 
                ? 'bg-indigo-50 text-indigo-700' 
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            Configurações (API)
          </button>
          <button
            onClick={() => setActiveTab('content')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'content'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <Library className="w-4 h-4" />
            Conteúdos Gerados
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-neutral-200">
          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'Usuário'} className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800 truncate">{user.displayName || 'Usuário'}</p>
              <p className="text-xs text-neutral-500 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full">
          <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sair
            </button>
          </div>
          <AnimatePresence mode="wait">
            {activeTab === 'generator' ? (
              <motion.div
                key="generator"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Gerar Novo Vídeo</h2>
                  <p className="text-neutral-500 mt-1">Comece pelo material bruto; o avatar HeyGen e as notas para o vídeo ficam nas etapas seguintes.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Main Action Area */}
                  <div className="lg:col-span-2 space-y-6 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                    
                    {/* Step 1: Raw Material Input */}
                    {['idle', 'generating_script'].includes(currentStep) && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                            <FileText className="w-4 h-4" />
                            Material Bruto da Reportagem *
                          </label>
                          <textarea
                            value={rawMaterial}
                            onChange={(e) => setRawMaterial(e.target.value)}
                            placeholder="Cole aqui os dados, fatos ou a reportagem bruta. A IA transforma o material num roteiro proporcional à duração escolhida abaixo."
                            className="w-full h-40 px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-none text-sm"
                            disabled={isGenerating}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-neutral-700">Duração prevista do vídeo</label>
                          <select
                            value={targetVideoDurationSeconds}
                            onChange={(e) => setTargetVideoDurationSeconds(Number(e.target.value))}
                            disabled={isGenerating}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm bg-white"
                          >
                            {VIDEO_DURATION_PRESETS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-neutral-500">
                            O roteiro será gerado com extensão compatível com essa duração de narração (ritmo de telejornal).
                          </p>
                        </div>

                        <button
                          onClick={handleGenerateScript}
                          disabled={isGenerating || !rawMaterial}
                          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Gerando Roteiro...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              Gerar Roteiro
                            </>
                          )}
                        </button>
                      </motion.div>
                    )}

                    {/* Step 2: Script Review */}
                    {['script_review', 'generating_audio'].includes(currentStep) && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-600" />
                            Revisão do Roteiro
                          </h3>
                          <button 
                            onClick={() => setCurrentStep('idle')}
                            disabled={isGenerating}
                            className="text-sm text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
                          >
                            <ArrowLeft className="w-4 h-4" /> Voltar
                          </button>
                        </div>
                        
                        <p className="text-sm text-neutral-500">
                          Revise e edite o roteiro gerado pela IA antes de enviá-lo para a geração de áudio.
                        </p>

                        <textarea
                          value={editableScript}
                          onChange={(e) => setEditableScript(e.target.value)}
                          className="w-full h-64 px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-none text-sm leading-relaxed"
                          disabled={isGenerating}
                        />

                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <label className="text-sm font-medium text-neutral-800 flex items-center gap-2">
                              <Mic className="w-4 h-4 text-indigo-600" />
                              Voz da narração (ElevenLabs)
                            </label>
                            <button
                              type="button"
                              onClick={() => setActiveTab('settings')}
                              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                            >
                              API key e voz avançada →
                            </button>
                          </div>
                          {!apiKeys.elevenlabs ? (
                            <p className="text-sm text-amber-800">
                              Cadastre a chave ElevenLabs em Configurações para gerar áudio.
                            </p>
                          ) : (
                            <>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-neutral-600">
                                  Voice ID (obrigatório)
                                </label>
                                <input
                                  type="text"
                                  value={apiKeys.elevenlabsVoiceId}
                                  onChange={(e) => updateApiKey('elevenlabsVoiceId', e.target.value)}
                                  placeholder="My Voices no site ElevenLabs → copie o voice_id"
                                  disabled={isGenerating}
                                  className="w-full px-3 py-2.5 rounded-lg border border-neutral-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                                <p className="text-xs text-neutral-500">
                                  No plano gratuito, a API não aceita vozes da Voice Library. Use um ID de voz da sua
                                  conta. A permissão <code className="text-neutral-700">text_to_speech</code> gera o
                                  áudio; <code className="text-neutral-700">voices_read</code> só preenche a lista
                                  abaixo.
                                </p>
                                <a
                                  href="https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/create"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-indigo-600 hover:text-indigo-700 inline-block"
                                >
                                  Documentação: permissões de API key →
                                </a>
                              </div>

                              {elevenLabsVoicesLoading ? (
                                <div className="flex items-center gap-2 text-sm text-neutral-600 pt-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Tentando carregar lista de vozes…
                                </div>
                              ) : null}

                              {elevenLabsVoicesError ? (
                                <div
                                  className={`rounded-lg p-3 text-sm ${
                                    elevenLabsMissingVoicesRead
                                      ? 'bg-amber-50 border border-amber-200 text-amber-900'
                                      : 'bg-red-50 border border-red-100 text-red-800'
                                  }`}
                                >
                                  {elevenLabsVoicesError}
                                </div>
                              ) : null}

                              {!elevenLabsVoicesLoading && elevenLabsVoices.length > 0 ? (
                                <div className="space-y-2 pt-1">
                                  <label className="text-xs font-medium text-neutral-600">
                                    Ou escolha na lista (requer voices_read na chave)
                                  </label>
                                  <select
                                    value={elevenLabsVoiceSelectValue}
                                    onChange={(e) => handleElevenLabsVoiceSelect(e.target.value)}
                                    disabled={isGenerating}
                                    className="w-full px-3 py-2.5 rounded-lg border border-neutral-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                  >
                                    <option value="__pick__">Escolher da lista (preenche o Voice ID)</option>
                                    {elevenLabsVoices.map((v) => (
                                      <option key={v.voice_id} value={v.voice_id}>
                                        {v.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>

                        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/80 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                            <Upload className="w-4 h-4 shrink-0" />
                            Modo teste — enviar áudio (sem ElevenLabs)
                          </div>
                          <p className="text-xs text-amber-800/90">
                            Use um MP3, WAV, M4A, WebM ou OGG gravado por você. O roteiro atual é salvo no projeto; o
                            custo de áudio fica zerado para esta etapa.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                            <input
                              ref={testAudioInputRef}
                              type="file"
                              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                              disabled={isGenerating}
                              className="text-sm text-neutral-700 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-200 file:px-3 file:py-2 file:text-sm file:font-medium file:text-amber-900 hover:file:bg-amber-300"
                              onChange={(e) => setPendingTestAudio(e.target.files?.[0] ?? null)}
                            />
                            <button
                              type="button"
                              onClick={handleUploadTestAudio}
                              disabled={isGenerating || !pendingTestAudio || !editableScript}
                              className="sm:ml-auto py-2.5 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                            >
                              {isUploadingTestAudio ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Enviando…
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Usar arquivo como áudio
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <button
                          onClick={handleGenerateAudio}
                          disabled={
                            isGenerating ||
                            !editableScript ||
                            !apiKeys.elevenlabs ||
                            !apiKeys.elevenlabsVoiceId?.trim()
                          }
                          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Gerando Áudio...
                            </>
                          ) : (
                            <>
                              <Check className="w-5 h-5" />
                              Aprovar Roteiro e Gerar Áudio
                            </>
                          )}
                        </button>
                      </motion.div>
                    )}

                    {/* Step 3: Audio Review */}
                    {['audio_review', 'generating_video'].includes(currentStep) && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold flex items-center gap-2">
                            <Mic className="w-5 h-5 text-indigo-600" />
                            Revisão do Áudio
                          </h3>
                          <button 
                            onClick={() => setCurrentStep('script_review')}
                            disabled={isGenerating}
                            className="text-sm text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
                          >
                            <ArrowLeft className="w-4 h-4" /> Voltar ao Roteiro
                          </button>
                        </div>
                        
                        <p className="text-sm text-neutral-500">
                          Ouça o áudio gerado. Se estiver satisfeito, prossiga para a geração do vídeo final.
                        </p>

                        <div className="bg-neutral-50 p-6 rounded-xl border border-neutral-200 flex flex-col items-center gap-4">
                          {project?.audioUrl ? (
                            <audio controls src={project.audioUrl} className="w-full" />
                          ) : (
                            <div className="text-neutral-400 flex items-center gap-2">
                              <AlertCircle className="w-5 h-5" /> Áudio indisponível
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                            <Settings className="w-4 h-4" />
                            Informações adicionais para o vídeo (opcional)
                          </label>
                          <p className="text-xs text-neutral-500">
                            Contexto livre (aparece no título do vídeo no HeyGen). Comandos de fundo podem ir na mesma
                            caixa, separados por vírgula, ponto e vírgula ou linha — se houver vários, vale o último
                            fundo indicado:{' '}
                            <code className="mx-1 text-neutral-700">bg_color:#0f172a</code>,
                            <code className="mx-1 text-neutral-700">bg_image:https://...</code> ou{' '}
                            <code className="mx-1 text-neutral-700">bg_video:https://...</code>. O personagem é o das
                            Configurações.
                          </p>
                          <textarea
                            value={videoPromptInfo}
                            onChange={(e) => setVideoPromptInfo(e.target.value)}
                            placeholder="Ex.: bg_image:https://.../studio.jpg  ou  bg_color:#111827"
                            rows={3}
                            disabled={isGenerating}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-y text-sm"
                          />
                        </div>

                        <p className="text-xs text-neutral-500">
                          O HeyGen gera o vídeo com o seu áudio e o personagem escolhido em Configurações. O render pode
                          levar vários minutos; mantenha esta página aberta até concluir.
                        </p>
                        <button
                          onClick={handleGenerateVideo}
                          disabled={isGenerating}
                          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              A gerar vídeo no HeyGen…
                            </>
                          ) : (
                            <>
                              <Check className="w-5 h-5" />
                              Gerar vídeo com HeyGen
                            </>
                          )}
                        </button>
                      </motion.div>
                    )}

                    {/* Step 4: Completed */}
                    {currentStep === 'completed' && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 py-6">
                        <div className="text-center">
                          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 className="w-8 h-8" />
                          </div>
                          <h3 className="text-2xl font-bold">
                            {project?.videoIsDemo ? 'Etapa concluída (demonstração)' : 'Vídeo concluído!'}
                          </h3>
                          <p className="text-neutral-500 mt-2 max-w-lg mx-auto">
                            {project?.videoIsDemo ? (
                              <>
                                Ainda não há integração real com HeyGen/Kling: o player abaixo mostra apenas um{' '}
                                <strong className="text-neutral-700">vídeo de amostra</strong> para testar o fluxo. O seu
                                áudio e roteiro continuam guardados no projeto.
                              </>
                            ) : (
                              'Seu vídeo foi gerado e sincronizado com sucesso.'
                            )}
                          </p>
                        </div>

                        {project?.videoUrl ? (
                          <div className="rounded-2xl overflow-hidden border border-neutral-200 bg-black shadow-lg">
                            <video
                              src={project.videoUrl}
                              controls
                              playsInline
                              className="w-full aspect-video object-contain bg-black"
                            />
                            <div className="px-4 py-3 bg-neutral-900 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <span className="text-sm">
                                {project.videoIsDemo ? 'Amostra (Big Buck Bunny)' : 'Pré-visualização'}
                              </span>
                              <a
                                href={project.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-indigo-400 hover:text-indigo-300"
                              >
                                Abrir / baixar ficheiro →
                              </a>
                            </div>
                          </div>
                        ) : null}

                        <div className="text-center">
                          <button
                            onClick={handleReset}
                            className="mt-2 px-8 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-medium transition-colors inline-flex items-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            Criar novo vídeo
                          </button>
                        </div>
                      </motion.div>
                    )}

                  </div>

                  {/* Status & Output Sidebar */}
                  <div className="space-y-6">
                    {/* Workflow Status */}
                    <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 mb-4">Status do Fluxo</h3>
                      <div className="space-y-4">
                        <StatusItem 
                          icon={<Sparkles className="w-4 h-4" />} 
                          label="Roteirização (Gemini IA)" 
                          status={currentStep === 'idle' ? 'pending' : currentStep === 'generating_script' ? 'loading' : 'success'}
                          onClick={isGenerating ? undefined : () => setCurrentStep('script_review')}
                        />
                        <div className="w-0.5 h-4 bg-neutral-200 ml-4"></div>
                        <StatusItem 
                          icon={<Mic className="w-4 h-4" />} 
                          label="Geração de Áudio (ElevenLabs)" 
                          status={['idle', 'generating_script', 'script_review'].includes(currentStep) ? 'pending' : currentStep === 'generating_audio' ? 'loading' : currentStep === 'error' && !project?.audioUrl ? 'pending' : currentStep === 'error' && project?.status === 'generating_audio' ? 'error' : 'success'}
                          onClick={isGenerating ? undefined : () => setCurrentStep('audio_review')}
                        />
                        <div className="w-0.5 h-4 bg-neutral-200 ml-4"></div>
                        <StatusItem 
                          icon={<Video className="w-4 h-4" />} 
                          label="Vídeo (HeyGen)" 
                          status={['idle', 'generating_script', 'script_review', 'generating_audio', 'audio_review'].includes(currentStep) ? 'pending' : currentStep === 'generating_video' ? 'loading' : currentStep === 'completed' ? 'success' : 'error'}
                          onClick={isGenerating ? undefined : () => setCurrentStep('completed')}
                        />
                      </div>
                    </div>

                    {/* Generated Script Display (Only in later steps) */}
                    {project?.generatedScript && !['idle', 'generating_script', 'script_review'].includes(currentStep) && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white border border-neutral-200 p-6 rounded-2xl shadow-sm"
                      >
                        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500 mb-4 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Roteiro Aprovado
                        </h3>
                        <div className="text-sm text-neutral-700 bg-neutral-50 p-4 rounded-xl border border-neutral-100 max-h-48 overflow-y-auto whitespace-pre-wrap">
                          {project.generatedScript}
                        </div>
                      </motion.div>
                    )}

                    {/* Cost Estimation */}
                    {project?.cost && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl shadow-sm"
                      >
                        <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-800 mb-4 flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          Custo Estimado
                        </h3>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between text-emerald-700">
                            <span>Áudio ({project.cost.audioTokens} chars)</span>
                            <span className="font-medium">${project.cost.audioCost.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>Vídeo (~{project.cost.videoSeconds}s)</span>
                            <span className="font-medium">${project.cost.videoCost.toFixed(4)}</span>
                          </div>
                          <div className="pt-3 border-t border-emerald-200 flex justify-between text-emerald-900 font-bold">
                            <span>Custo Total</span>
                            <span>${project.cost.totalCost.toFixed(4)}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Final Output */}
                    {project?.status === 'completed' &&
                      project.videoUrl &&
                      currentStep !== 'completed' && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-black rounded-2xl overflow-hidden shadow-lg border border-neutral-800"
                      >
                        <video 
                          src={project.videoUrl} 
                          controls 
                          className="w-full aspect-video object-cover"
                        />
                        <div className="p-4 bg-neutral-900 text-white">
                          <p className="text-sm font-medium">
                            {project.videoIsDemo ? 'Vídeo de demonstração' : 'Vídeo gerado'}
                          </p>
                          <a href={project.videoUrl} download className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-block">
                            Abrir / baixar
                          </a>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Configurações de API</h2>
                  <p className="text-neutral-500 mt-1">Cadastre suas chaves de API para habilitar roteiro, áudio e vídeo. As chaves são salvas no Firebase para o seu usuário.</p>
                </div>

                <div className="space-y-6 bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm">
                  {isKeysLoading && (
                    <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-600 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando chaves salvas...
                    </div>
                  )}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-indigo-600" />
                      Geração de Roteiro (IA)
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">Gemini API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('gemini')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="password"
                          value={apiKeys.gemini}
                          onChange={(e) => updateApiKey('gemini', e.target.value)}
                          placeholder="AIza..."
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">GPT/OpenAI API Key (opcional, fallback)</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('openai')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="password"
                          value={apiKeys.openai}
                          onChange={(e) => updateApiKey('openai', e.target.value)}
                          placeholder="sk-..."
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                      <p className="text-xs text-neutral-500">Se Gemini estiver preenchido, ele será priorizado.</p>
                    </div>
                  </div>

                  <div className="w-full h-px bg-neutral-100 my-6"></div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Mic className="w-5 h-5 text-indigo-600" />
                      Geração de Áudio
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">ElevenLabs API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('elevenlabs')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="password"
                          value={apiKeys.elevenlabs}
                          onChange={(e) => updateApiKey('elevenlabs', e.target.value)}
                          placeholder="sk_..."
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">ElevenLabs Voice ID</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('elevenlabsVoiceId')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="text"
                          value={apiKeys.elevenlabsVoiceId}
                          onChange={(e) => updateApiKey('elevenlabsVoiceId', e.target.value)}
                          placeholder="My Voices → copie o voice_id"
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                      <p className="text-xs text-neutral-500">
                        Obrigatório para gerar áudio. Plano free: use voz da sua conta, não da Voice Library. Em servidor
                        próprio, <code className="text-neutral-700">ELEVENLABS_DEFAULT_VOICE_ID</code> pode substituir
                        se configurado.
                      </p>
                    </div>
                  </div>

                  <div className="w-full h-px bg-neutral-100 my-6"></div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Video className="w-5 h-5 text-indigo-600" />
                      Geração de Vídeo / Avatares
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">HeyGen API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('heygen')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="password"
                          value={apiKeys.heygen}
                          onChange={(e) => updateApiKey('heygen', e.target.value)}
                          placeholder="Insira sua chave do HeyGen..."
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-sm font-medium text-neutral-700">Personagem HeyGen</label>
                        <button
                          type="button"
                          onClick={() => void loadHeygenCharacters()}
                          disabled={isKeysLoading || heygenListLoading || !apiKeys.heygen?.trim()}
                          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
                        >
                          {heygenListLoading ? 'A carregar…' : 'Carregar lista da API'}
                        </button>
                      </div>
                      <select
                        value={heygenPickSelectValue}
                        onChange={(e) => applyHeygenCharacterPick(e.target.value)}
                        disabled={isKeysLoading || heygenAvatars.length === 0}
                        className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm bg-white"
                      >
                        <option value="">
                          {heygenAvatars.length === 0
                            ? 'Carregue a lista ou defina o ID abaixo'
                            : 'Escolher na lista…'}
                        </option>
                        {heygenAvatars.length > 0 ? (
                          <optgroup label="Avatares">
                            {heygenAvatars.map((a) => (
                              <option key={`heygen-avatar-${a.avatar_id}`} value={`avatar:${a.avatar_id}`}>
                                {a.avatar_name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                      {heygenListError ? (
                        <p className="text-xs text-red-700">{heygenListError}</p>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">ID do personagem</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('heygenCharacterId')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="text"
                          value={apiKeys.heygenCharacterId}
                          onChange={(e) => updateApiKey('heygenCharacterId', e.target.value)}
                          placeholder="avatar_id"
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-neutral-700">Kling API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('kling')}
                          className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                          type="password"
                          value={apiKeys.kling}
                          onChange={(e) => updateApiKey('kling', e.target.value)}
                          placeholder="Insira sua chave do Kling..."
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 text-amber-800 text-sm">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>
                      <strong>Aviso de Segurança:</strong> As chaves ficam no Firestore da sua conta. Para producao, o ideal e criptografar antes de salvar e acessar provedores por rotas server-side.
                    </p>
                  </div>
                </div>

                {helpModalKey && (
                  <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl p-6 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <h4 className="text-lg font-semibold text-neutral-900">{KEY_HELP_CONTENT[helpModalKey].title}</h4>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey(null)}
                          className="text-neutral-500 hover:text-neutral-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <ol className="list-decimal list-inside space-y-2 text-sm text-neutral-700">
                        {KEY_HELP_CONTENT[helpModalKey].steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <a
                        href={KEY_HELP_CONTENT[helpModalKey].link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Abrir pagina da plataforma
                      </a>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl space-y-8"
              >
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Conteúdos Gerados</h2>
                  <p className="text-neutral-500 mt-1">Histórico completo de inputs e saídas geradas no seu usuário.</p>
                </div>

                {isProjectsLoading ? (
                  <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-center gap-2 text-neutral-600">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Carregando conteúdos...
                  </div>
                ) : savedProjects.length === 0 ? (
                  <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm text-neutral-500">
                    Nenhum conteúdo salvo ainda.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {savedProjects.map((item) => (
                      <div key={item.id} className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-neutral-900">Projeto {item.id}</h3>
                            <p className="text-xs text-neutral-500">{new Date(item.date).toLocaleString('pt-BR')}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded-full bg-neutral-100 text-neutral-700">
                            {item.status}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Input (Material Bruto)</p>
                          <div className="text-sm text-neutral-700 bg-neutral-50 p-3 rounded-lg whitespace-pre-wrap">
                            {item.rawMaterial}
                          </div>
                          {typeof item.targetVideoDurationSeconds === 'number' && item.targetVideoDurationSeconds > 0 ? (
                            <p className="text-xs text-neutral-600">
                              Duração prevista:{' '}
                              {VIDEO_DURATION_PRESETS.find((o) => o.value === item.targetVideoDurationSeconds)?.label ??
                                `${item.targetVideoDurationSeconds} s`}
                            </p>
                          ) : null}
                        </div>

                        {item.promptInfo && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Notas para o vídeo (HeyGen)</p>
                            <div className="text-sm text-neutral-700 bg-neutral-50 p-3 rounded-lg whitespace-pre-wrap">
                              {item.promptInfo}
                            </div>
                          </div>
                        )}

                        {item.generatedScript && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Roteiro gerado</p>
                            <div className="text-sm text-neutral-700 bg-neutral-50 p-3 rounded-lg whitespace-pre-wrap">
                              {item.generatedScript}
                            </div>
                          </div>
                        )}

                        {(item.audioUrl || item.videoUrl) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            {item.audioUrl && (
                              <a href={item.audioUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700">
                                Abrir áudio gerado
                              </a>
                            )}
                            {item.videoUrl && (
                              <a href={item.videoUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700">
                                Abrir vídeo gerado
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function StatusItem({
  icon,
  label,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  onClick?: () => void;
}) {
  const isClickable = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={`w-full flex items-center gap-3 text-left ${
        isClickable ? 'cursor-pointer hover:opacity-85 transition-opacity' : 'cursor-default'
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        status === 'pending' ? 'bg-neutral-100 text-neutral-400' :
        status === 'loading' ? 'bg-indigo-100 text-indigo-600' :
        status === 'error' ? 'bg-red-100 text-red-600' :
        'bg-emerald-100 text-emerald-600'
      }`}>
        {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> :
         status === 'success' ? <CheckCircle2 className="w-4 h-4" /> :
         status === 'error' ? <AlertCircle className="w-4 h-4" /> :
         icon}
      </div>
      <span className={`text-sm font-medium ${
        status === 'pending' ? 'text-neutral-500' :
        status === 'loading' ? 'text-indigo-700' :
        status === 'error' ? 'text-red-700' :
        'text-emerald-700'
      }`}>
        {label}
      </span>
    </button>
  );
}
