'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import heroVisual from '@/lib/assets/studio-hero.jpeg';
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
  Library,
  Languages,
} from 'lucide-react';
import { ApiKeys, GenerationCost, VideoProject } from '@/types';
import { VideoTranslationTab } from '@/components/VideoTranslationTab';
import { SiteFooter, SiteHeader, PoweredByBuildAI } from '@/components/SiteChrome';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseDb, isFirebaseConfigured } from '@/lib/firebase';

const INITIAL_KEYS: ApiKeys = {
  gemini: '',
  elevenlabs: '',
  elevenlabsVoiceId: '',
  heygen: '',
  heygenVoiceId: '',
  heygenCharacterId: '',
  heygenCharacterKind: 'avatar',
  heygenEngine: 'avatar_v',
  kling: '',
  openai: '',
};

const DEFAULT_VIDEO_DURATION_SECONDS = 60;

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
      'Em Config, carregue a lista de personagens HeyGen (com a API key preenchida).',
      'Escolha um avatar na lista ou cole um avatar_id / look_id.',
      'Para Avatar V, use um look Digital Twin elegível (supported_api_engines).',
    ],
    link: 'https://docs.heygen.com/reference/list-avatars-v2',
  },
  heygenVoiceId: {
    title: 'HeyGen — voz do avatar',
    steps: [
      'Nao e necessario configurar Voice ID neste app.',
      'A narração usa automaticamente a voz padrao do avatar escolhido em "ID do personagem".',
      'Se precisar de outra voz, troque o avatar no HeyGen.',
    ],
    link: 'https://developers.heygen.com/docs/quick-start',
  },
  heygenCharacterKind: {
    title: 'Tipo de personagem HeyGen',
    steps: [
      'Este app esta configurado para usar apenas Avatar.',
      'Se estava em Talking Photo, altere para Avatar e use um avatar_id.',
    ],
    link: 'https://docs.heygen.com/docs/create-videos-with-avatars',
  },
  heygenEngine: {
    title: 'HeyGen — motor Avatar IV / Avatar V',
    steps: [
      'Avatar V e o motor de maior fidelidade (opt-in). Exige um look Digital Twin com avatar_v em supported_api_engines.',
      'Em Configuracoes, escolha Avatar V e cole o look_id elegivel (GET /v3/avatars/looks/{look_id}).',
      'Se o personagem nao for elegivel, a geracao falha com mensagem clara — use Avatar IV nesse caso.',
      'Avatar IV e o padrao da API e funciona com a maioria dos avatares.',
    ],
    link: 'https://developers.heygen.com/docs/avatar-v',
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
  const [activeTab, setActiveTab] = useState<'generator' | 'translation' | 'settings' | 'content'>('generator');
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
  const [audioSourceMode, setAudioSourceMode] = useState<'elevenlabs' | 'heygen'>('heygen');

  // Generator State
  const [rawMaterial, setRawMaterial] = useState('');
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
          '[Studio] Firebase Auth demorou a responder; a verificacao de sessao foi interrompida. Verifique rede, bloqueadores e dominios autorizados no Firebase Console.'
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
    if (
      currentStep !== 'script_review' ||
      audioSourceMode !== 'elevenlabs' ||
      !apiKeys.elevenlabs ||
      !firebaseAuth?.currentUser
    ) {
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
  }, [currentStep, audioSourceMode, apiKeys.elevenlabs, user]);

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

  /** Garante um projeto ativo quando o roteiro existe mas o estado `project` foi perdido (ex.: navegação na barra lateral). */
  const resolveActiveProject = async (): Promise<VideoProject | null> => {
    if (project?.id) {
      const synced: VideoProject = {
        ...project,
        generatedScript: editableScript.trim() || project.generatedScript,
      };
      if (synced.generatedScript !== project.generatedScript) {
        setProject(synced);
      }
      return synced;
    }

    if (!editableScript.trim()) return null;

    const scriptTrim = editableScript.trim();
    const fromSaved =
      savedProjects.find((p) => p.generatedScript?.trim() === scriptTrim) ??
      savedProjects.find((p) => p.status === 'script_review') ??
      savedProjects[0];

    if (fromSaved?.id) {
      const restored: VideoProject = {
        ...fromSaved,
        generatedScript: editableScript,
        status: 'script_review',
      };
      setProject(restored);
      return restored;
    }

    const created: VideoProject = {
      id: Math.random().toString(36).substring(7),
      date: new Date().toISOString(),
      rawMaterial: rawMaterial.trim() || '(roteiro sem texto de origem)',
      targetVideoDurationSeconds: DEFAULT_VIDEO_DURATION_SECONDS,
      generatedScript: editableScript,
      status: 'script_review',
    };
    setProject(created);
    await persistProject(created);
    return created;
  };

  const navigateWorkflowStep = (step: VideoProject['status']) => {
    if (step === 'script_review' && !project?.id) {
      const scriptTrim = editableScript.trim();
      const fromSaved =
        savedProjects.find((p) => p.generatedScript?.trim() === scriptTrim) ??
        savedProjects.find((p) => p.status === 'script_review') ??
        savedProjects[0];
      if (fromSaved?.id) {
        setProject({
          ...fromSaved,
          generatedScript: editableScript || fromSaved.generatedScript || '',
          status: 'script_review',
        });
        if (!editableScript && fromSaved.generatedScript) {
          setEditableScript(fromSaved.generatedScript);
        }
      }
    }
    setCurrentStep(step);
  };

  useEffect(() => {
    if (!user || !['script_review', 'generating_audio'].includes(currentStep)) return;
    if (project?.id || !editableScript.trim()) return;

    const scriptTrim = editableScript.trim();
    const fromSaved =
      savedProjects.find((p) => p.generatedScript?.trim() === scriptTrim) ??
      savedProjects.find((p) => p.status === 'script_review');

    if (fromSaved?.id) {
      setProject({
        ...fromSaved,
        generatedScript: editableScript,
        status: 'script_review',
      });
    }
  }, [user, currentStep, project?.id, editableScript, savedProjects]);

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
      alert('Cole o texto ou notas que quer transformar em vídeo.');
      return;
    }
    setIsGenerating(true);
    setCurrentStep('generating_script');
    setVideoPromptInfo('');

    const newProject: VideoProject = {
      id: Math.random().toString(36).substring(7),
      date: new Date().toISOString(),
      rawMaterial,
      targetVideoDurationSeconds: DEFAULT_VIDEO_DURATION_SECONDS,
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
          targetVideoDurationSeconds: DEFAULT_VIDEO_DURATION_SECONDS,
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
    const baseProject = await resolveActiveProject();
    if (!baseProject) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }

    setIsGenerating(true);
    setCurrentStep('generating_audio');
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
        audioSource: 'elevenlabs',
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

  const handleApproveWithHeygenVoice = async () => {
    if (!apiKeys.heygen?.trim()) {
      alert('Configure a API Key do HeyGen em Config.');
      setActiveTab('settings');
      return;
    }
    if (!apiKeys.heygenCharacterId?.trim()) {
      alert('Escolha ou cole o ID do personagem HeyGen em Config.');
      setActiveTab('settings');
      return;
    }
    const baseProject = await resolveActiveProject();
    if (!baseProject) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }
    if (!editableScript.trim()) {
      alert('O roteiro está vazio.');
      return;
    }

    const cost: GenerationCost = {
      audioTokens: editableScript.length,
      audioCost: 0,
      videoSeconds: 0,
      videoCost: 0,
      totalCost: 0,
    };
    const readyProject: VideoProject = {
      ...baseProject,
      generatedScript: editableScript,
      status: 'audio_review',
      audioSource: 'heygen',
      cost,
    };
    setProject(readyProject);
    await persistProject(readyProject);
    setCurrentStep('audio_review');
  };

  const handleUploadTestAudio = async () => {
    if (!pendingTestAudio) {
      alert('Selecione um arquivo de áudio.');
      return;
    }
    const baseProject = await resolveActiveProject();
    if (!baseProject) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }

    setIsGenerating(true);
    setIsUploadingTestAudio(true);
    setCurrentStep('generating_audio');
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
        audioSource: 'elevenlabs',
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
    const activeProject =
      (project?.id && (project.audioUrl || project.audioSource === 'heygen') ? project : null) ??
      savedProjects.find((p) => p.audioSource === 'heygen' || (p.audioUrl && p.cost));
    if (!activeProject?.id) {
      alert('Projeto não encontrado. Gere o roteiro novamente.');
      setCurrentStep('idle');
      return;
    }
    if (activeProject !== project) {
      setProject(activeProject);
      if (activeProject.generatedScript) setEditableScript(activeProject.generatedScript);
    }
    const usesHeygenVoice = activeProject.audioSource === 'heygen';
    if (!usesHeygenVoice && !activeProject.cost) {
      alert('Custo de áudio não encontrado. Gere o áudio novamente.');
      setCurrentStep('script_review');
      return;
    }
    if (!usesHeygenVoice && !activeProject.audioUrl) {
      alert('É necessário ter áudio no projeto antes de gerar o vídeo.');
      return;
    }
    if (!apiKeys.heygen?.trim()) {
      alert('Configure a API Key do HeyGen em Config.');
      setActiveTab('settings');
      return;
    }
    if (!apiKeys.heygenCharacterId?.trim()) {
      alert('Escolha ou cole o ID do personagem HeyGen (avatar ou talking photo) em Config.');
      setActiveTab('settings');
      return;
    }

    setIsGenerating(true);
    setCurrentStep('generating_video');
    const videoNotesTrim = videoPromptInfo.trim();
    const baseProject: VideoProject = {
      ...activeProject,
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
          audioSource: usesHeygenVoice ? 'heygen' : 'elevenlabs',
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
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 stage-grid opacity-40" aria-hidden />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative flex flex-col items-center gap-4"
        >
          <div className="h-14 w-14 rounded-2xl bg-signal/15 ring-1 ring-signal/30 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-signal" />
          </div>
          <p className="font-display text-sm tracking-wide text-mist">A carregar…</p>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-x-hidden text-foam flex flex-col">
        <div className="absolute inset-0 stage-grid opacity-50" aria-hidden />
        <div className="absolute -top-40 left-0 h-[28rem] w-[28rem] rounded-full bg-signal/10 blur-3xl" aria-hidden />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-warm/10 blur-3xl" aria-hidden />

        <SiteHeader
          variant="marketing"
          onSignIn={isFirebaseConfigured ? handleGoogleSignIn : undefined}
        />

        <div className="relative z-10 mx-auto flex w-full flex-1 max-w-6xl flex-col lg:flex-row lg:items-center gap-12 lg:gap-20 px-6 py-12 sm:px-10">
          <div id="recursos" className="flex flex-1 flex-col justify-center max-w-xl scroll-mt-20">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <p className="font-display text-5xl font-extrabold leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">
                Studio
              </p>
              <h1 className="mt-5 font-display text-2xl font-semibold leading-snug tracking-tight text-foam sm:text-3xl">
                Vídeos com avatar, do texto ao render.
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-mist sm:text-[1.05rem]">
                Um fluxo único para transformar conteúdo em peça pronta: roteiro, voz e apresentador virtual —
                com controlo em cada etapa.
              </p>
            </motion.div>

            <motion.ul
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12 }}
              className="mt-10 space-y-6"
            >
              <li className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/10 ring-1 ring-signal/25">
                  <DollarSign className="h-4 w-4 text-signal" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-foam">Custo via API, sem markup de plataforma</p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">
                    Paga só o consumo das APIs (HeyGen, ElevenLabs, Gemini/OpenAI). Em média, até 60% mais barato
                    do que produzir o mesmo vídeo nas interfaces e planos das ferramentas.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/10 ring-1 ring-signal/25">
                  <FileText className="h-4 w-4 text-signal" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-foam">Roteiro sob medida</p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">
                    A IA adapta o seu texto à duração escolhida — claro, direto e pronto para narração.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/10 ring-1 ring-signal/25">
                  <Mic className="h-4 w-4 text-signal" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-foam">Voz do avatar ou ElevenLabs</p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">
                    Use a voz nativa do personagem HeyGen ou gere áudio com ElevenLabs — e revise antes do vídeo.
                  </p>
                </div>
              </li>
              <li id="fluxo" className="flex gap-4 scroll-mt-24">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/10 ring-1 ring-signal/25">
                  <Video className="h-4 w-4 text-signal" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-foam">Render com Avatar IV ou V</p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">
                    Produza o vídeo com o seu avatar HeyGen, escolha o motor de render e acompanhe até à entrega.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/10 ring-1 ring-signal/25">
                  <Languages className="h-4 w-4 text-signal" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-foam">Tradução de vídeo</p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">
                    Envie um vídeo existente e receba a mesma peça com áudio traduzido e sincronizado.
                  </p>
                </div>
              </li>
            </motion.ul>
          </div>

          <motion.div
            id="entrar"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            className="w-full max-w-md lg:w-[22rem] shrink-0 lg:ml-auto flex flex-col gap-4 scroll-mt-24"
          >
            <div className="relative overflow-hidden rounded-[1.25rem] border border-line bg-panel">
              <div className="relative aspect-[4/3] w-full">
                <Image
                  src={heroVisual}
                  alt="Avatar em estúdio de geração de vídeo"
                  fill
                  priority
                  className="object-cover object-center"
                  sizes="(max-width: 1024px) 100vw, 22rem"
                />
              </div>
            </div>

            <div
              id="custo"
              className="rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 scroll-mt-24"
            >
              <p className="font-display text-2xl font-extrabold leading-none text-signal">até 60%</p>
              <p className="mt-1.5 text-sm leading-snug text-foam/90">
                mais barato via APIs do que no HeyGen e ferramentas similares
              </p>
            </div>

            <div className="panel p-6 sm:p-8">
              <p className="font-display text-xl font-bold text-foam">Entrar</p>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                {isFirebaseConfigured
                  ? 'Aceda com Google para guardar projetos, avatares e chaves de API com segurança.'
                  : isProdBuild
                    ? 'As variáveis públicas do Firebase não estão neste build — configura-as no painel de hospedagem.'
                    : 'Configura o Firebase no projeto para ativar o login.'}
              </p>
              {isFirebaseConfigured ? (
                <button type="button" onClick={handleGoogleSignIn} className="btn-primary mt-6 w-full">
                  Continuar com Google
                </button>
              ) : isProdBuild ? (
                <div className="mt-5 space-y-3 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm leading-relaxed text-foam/90">
                  <p>
                    No{' '}
                    <a
                      href="https://console.firebase.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-signal underline underline-offset-2"
                    >
                      Firebase Console
                    </a>
                    : App Hosting → Environment. Adiciona as variáveis{' '}
                    <code className="rounded bg-ink px-1 text-xs">NEXT_PUBLIC_FIREBASE_*</code>.
                  </p>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-foam/90">
                  Cria <code className="rounded bg-ink px-1.5 text-xs">.env.local</code> com{' '}
                  <code className="rounded bg-ink px-1.5 text-xs">NEXT_PUBLIC_FIREBASE_*</code> e reinicia o dev server.
                </div>
              )}
              {isFirebaseConfigured ? (
                <p className="mt-5 text-center text-xs text-mist/80">
                  Projetos e definições ficam privados na sua conta.
                </p>
              ) : null}
              <div className="mt-6 flex justify-center border-t border-line/60 pt-5">
                <PoweredByBuildAI />
              </div>
            </div>
          </motion.div>
        </div>

        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foam font-sans flex flex-col">
      <SiteHeader
        variant="app"
        onSignOut={handleSignOut}
        userLabel={user.displayName || undefined}
        userEmail={user.email || undefined}
        userPhotoUrl={user.photoURL}
      />

      <div className="flex flex-1 flex-col md:flex-row min-h-0">
        <aside className="w-full md:w-56 bg-ink-2/95 border-b md:border-b-0 md:border-r border-line backdrop-blur-xl p-4 md:p-5 flex flex-col gap-4 relative z-10 shrink-0">
          <p className="label-caps px-2 hidden md:block">Navegação</p>
          <nav className="flex md:flex-col gap-1.5 overflow-x-auto">
            {(
              [
                { id: 'generator' as const, label: 'Estúdio', icon: Play },
                { id: 'translation' as const, label: 'Tradução', icon: Languages },
                { id: 'content' as const, label: 'Biblioteca', icon: Library },
                { id: 'settings' as const, label: 'Config', icon: Settings },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`nav-item whitespace-nowrap ${activeTab === id ? 'nav-item-active' : 'nav-item-idle'}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-6 md:p-10 overflow-y-auto relative min-h-0">
          <div className="pointer-events-none absolute inset-0 stage-grid opacity-30" aria-hidden />
          <div className="relative max-w-5xl mx-auto w-full">
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
                    <h2 className="font-display text-3xl font-bold tracking-tight">Novo vídeo</h2>
                    <p className="text-mist mt-1">Escreva o conteúdo, revise o roteiro e gere o vídeo com o seu avatar.</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Action Area */}
                    <div className="lg:col-span-2 space-y-6 panel p-6 ">

                      {/* Step 1: Raw Material Input */}
                      {['idle', 'generating_script'].includes(currentStep) && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-foam/85">
                              <FileText className="w-4 h-4" />
                              Texto de origem *
                            </label>
                            <textarea
                              value={rawMaterial}
                            onChange={(e) => setRawMaterial(e.target.value)}
                            placeholder="Cole fatos, notas ou um rascunho. A IA gera um roteiro pronto para narração."
                            className="input-field h-40 resize-none focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                            disabled={isGenerating}
                          />
                        </div>

                        <button
                          onClick={handleGenerateScript}
                          disabled={isGenerating || !rawMaterial}
                          className="btn-primary w-full py-4"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              A gerar roteiro…
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              Gerar roteiro
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
                            <FileText className="w-5 h-5 text-signal" />
                            Revisar roteiro
                          </h3>
                          <button 
                            onClick={() => setCurrentStep('idle')}
                            disabled={isGenerating}
                            className="text-sm text-mist hover:text-foam/85 flex items-center gap-1"
                          >
                            <ArrowLeft className="w-4 h-4" /> Voltar
                          </button>
                        </div>
                        
                        <p className="text-sm text-mist">
                          Edite o texto antes de escolher como gerar a voz.
                        </p>

                        <textarea
                          value={editableScript}
                          onChange={(e) => setEditableScript(e.target.value)}
                          className="input-field h-64 resize-none leading-relaxed"
                          disabled={isGenerating}
                        />

                        <div className="rounded-xl border border-signal/20 bg-signal/5 p-4 text-xs text-foam space-y-1">
                          <p className="font-medium text-sm">Como funciona</p>
                          <p>
                            <strong>HeyGen</strong> — avatar e narração com a <strong>voz do personagem</strong> escolhido.
                          </p>
                          <p>
                            <strong>ElevenLabs</strong> (opcional) — só o ficheiro de áudio; o avatar continua no HeyGen.
                          </p>
                        </div>

                        <div className="panel-soft p-4 space-y-3">
                          <label className="text-sm font-medium text-foam">Fonte da voz</label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              onClick={() => setAudioSourceMode('heygen')}
                              disabled={isGenerating}
                              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium border transition-colors ${
                                audioSourceMode === 'heygen'
                                  ? 'bg-signal text-signal-ink border-signal'
                                  : 'bg-panel text-foam/85 border-line hover:bg-ink-2'
                              }`}
                            >
                              Voz do avatar (HeyGen)
                            </button>
                            <button
                              type="button"
                              onClick={() => setAudioSourceMode('elevenlabs')}
                              disabled={isGenerating}
                              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium border transition-colors ${
                                audioSourceMode === 'elevenlabs'
                                  ? 'bg-signal text-signal-ink border-signal'
                                  : 'bg-panel text-foam/85 border-line hover:bg-ink-2'
                              }`}
                            >
                              ElevenLabs
                            </button>
                          </div>
                          <p className="text-xs text-mist">
                            {audioSourceMode === 'heygen'
                              ? 'A narração usa a voz padrão do avatar. Sem ElevenLabs.'
                              : 'Gera áudio com ElevenLabs (ou envie um ficheiro de teste) antes do vídeo.'}
                          </p>
                        </div>

                        {audioSourceMode === 'elevenlabs' ? (
                        <div className="panel-soft p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <label className="text-sm font-medium text-foam flex items-center gap-2">
                              <Mic className="w-4 h-4 text-signal" />
                              Voz ElevenLabs
                            </label>
                            <button
                              type="button"
                              onClick={() => setActiveTab('settings')}
                              className="text-xs text-signal hover:text-signal-dim font-medium"
                            >
                              API key e voz avançada →
                            </button>
                          </div>
                          {!apiKeys.elevenlabs ? (
                            <p className="text-sm text-warn">
                              Adicione a chave ElevenLabs em Config para gerar áudio.
                            </p>
                          ) : (
                            <>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-mist">
                                  Voice ID (obrigatório)
                                </label>
                                <input
                                  type="text"
                                  value={apiKeys.elevenlabsVoiceId}
                                  onChange={(e) => updateApiKey('elevenlabsVoiceId', e.target.value)}
                                  placeholder="My Voices no site ElevenLabs → copie o voice_id"
                                  disabled={isGenerating}
                                  className="input-field bg-panel text-sm focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none"
                                />
                                <p className="text-xs text-mist">
                                  No plano gratuito, a API não aceita vozes da Voice Library. Use um ID de voz da sua
                                  conta. A permissão <code className="text-foam/85">text_to_speech</code> gera o
                                  áudio; <code className="text-foam/85">voices_read</code> só preenche a lista
                                  abaixo.
                                </p>
                                <a
                                  href="https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/create"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-signal hover:text-signal-dim inline-block"
                                >
                                  Documentação: permissões de API key →
                                </a>
                              </div>

                              {elevenLabsVoicesLoading ? (
                                <div className="flex items-center gap-2 text-sm text-mist pt-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Tentando carregar lista de vozes…
                                </div>
                              ) : null}

                              {elevenLabsVoicesError ? (
                                <div
                                  className={`rounded-lg p-3 text-sm ${
                                    elevenLabsMissingVoicesRead
                                      ? 'bg-warn/10 border border-warn/30 text-warn'
                                      : 'bg-warm/10 border border-warm/30 text-warm'
                                  }`}
                                >
                                  {elevenLabsVoicesError}
                                </div>
                              ) : null}

                              {!elevenLabsVoicesLoading && elevenLabsVoices.length > 0 ? (
                                <div className="space-y-2 pt-1">
                                  <label className="text-xs font-medium text-mist">
                                    Ou escolha na lista (requer voices_read na chave)
                                  </label>
                                  <select
                                    value={elevenLabsVoiceSelectValue}
                                    onChange={(e) => handleElevenLabsVoiceSelect(e.target.value)}
                                    disabled={isGenerating}
                                    className="input-field bg-panel text-sm focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none"
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
                        ) : (
                        <div className="rounded-xl border border-line bg-signal/5 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <label className="text-sm font-medium text-foam flex items-center gap-2">
                              <Video className="w-4 h-4 text-signal" />
                              Voz do avatar
                            </label>
                            <button
                              type="button"
                              onClick={() => setActiveTab('settings')}
                              className="text-xs text-signal hover:text-signal-dim font-medium"
                            >
                              API key e personagem →
                            </button>
                          </div>
                          {!apiKeys.heygen ? (
                            <p className="text-sm text-warn">
                              Adicione a chave HeyGen em Config.
                            </p>
                          ) : !apiKeys.heygenCharacterId?.trim() ? (
                            <p className="text-sm text-warn">
                              Escolha um avatar em Config. A voz será a padrão desse personagem.
                            </p>
                          ) : (
                            <p className="text-sm text-foam/85">
                              O texto será lido pela voz do avatar{' '}
                              <code className="text-xs bg-panel/80 px-1.5 py-0.5 rounded border border-line">
                                {apiKeys.heygenCharacterId}
                              </code>
                              {apiKeys.heygenEngine === 'avatar_v'
                                ? ' com motor Avatar V'
                                : ' com motor Avatar IV'}
                              . Não precisa de Voice ID.
                            </p>
                          )}
                        </div>
                        )}

                        {audioSourceMode === 'elevenlabs' ? (
                        <div className="rounded-xl border border-dashed border-warn/40 bg-warn/10 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-warn">
                            <Upload className="w-4 h-4 shrink-0" />
                            Teste — enviar áudio
                          </div>
                          <p className="text-xs text-warn/90">
                            MP3, WAV, M4A, WebM ou OGG. O roteiro é guardado; o custo de áudio fica a zero nesta etapa.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                            <input
                              ref={testAudioInputRef}
                              type="file"
                              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                              disabled={isGenerating}
                              className="text-sm text-foam/85 file:mr-3 file:rounded-lg file:border-0 file:bg-warn/30 file:px-3 file:py-2 file:text-sm file:font-medium file:text-warn hover:file:bg-warn/40"
                              onChange={(e) => setPendingTestAudio(e.target.files?.[0] ?? null)}
                            />
                            <button
                              type="button"
                              onClick={handleUploadTestAudio}
                              disabled={isGenerating || !pendingTestAudio || !editableScript}
                              className="sm:ml-auto py-2.5 px-4 rounded-lg bg-warm hover:bg-warm/90 text-foam disabled:bg-line disabled:text-mist disabled:cursor-not-allowed text-sm font-medium transition-colors flex items-center justify-center gap-2"
                            >
                              {isUploadingTestAudio ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Enviando…
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Usar este áudio
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        ) : null}

                        {audioSourceMode === 'heygen' ? (
                        <button
                          type="button"
                          onClick={handleApproveWithHeygenVoice}
                          disabled={
                            isGenerating ||
                            !editableScript ||
                            !apiKeys.heygen ||
                            !apiKeys.heygenCharacterId?.trim()
                          }
                          className="btn-primary w-full py-4"
                        >
                          <Check className="w-5 h-5" />
                          Aprovar e continuar
                        </button>
                        ) : (
                        <button
                          onClick={handleGenerateAudio}
                          disabled={
                            isGenerating ||
                            !editableScript ||
                            !apiKeys.elevenlabs ||
                            !apiKeys.elevenlabsVoiceId?.trim()
                          }
                          className="btn-primary w-full py-4"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Gerando Áudio...
                            </>
                          ) : (
                            <>
                              <Check className="w-5 h-5" />
                              Aprovar e gerar áudio
                            </>
                          )}
                        </button>
                        )}
                      </motion.div>
                    )}

                    {/* Step 3: Audio Review */}
                    {['audio_review', 'generating_video'].includes(currentStep) && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold flex items-center gap-2">
                            <Mic className="w-5 h-5 text-signal" />
                            Revisão do Áudio
                          </h3>
                          <button 
                            onClick={() => navigateWorkflowStep('script_review')}
                            disabled={isGenerating}
                            className="text-sm text-mist hover:text-foam/85 flex items-center gap-1"
                          >
                            <ArrowLeft className="w-4 h-4" /> Voltar ao Roteiro
                          </button>
                        </div>
                        
                        <p className="text-sm text-mist">
                          {project?.audioSource === 'heygen'
                            ? 'A narração será gerada pelo HeyGen junto com o vídeo. Revise o roteiro e as notas abaixo antes de renderizar.'
                            : 'Ouça o áudio gerado. Se estiver satisfeito, prossiga para a geração do vídeo final.'}
                        </p>

                        <div className="bg-ink-2 p-6 rounded-xl border border-line flex flex-col items-center gap-4">
                          {project?.audioSource === 'heygen' ? (
                            <div className="text-sm text-foam bg-signal/5 border border-signal/20 rounded-lg p-4 w-full text-center">
                              <p className="font-medium">Áudio via HeyGen</p>
                              <p className="text-xs text-mist mt-1">
                                Sem pré-escuta — o HeyGen sintetiza a voz a partir do roteiro ao criar o vídeo.
                              </p>
                            </div>
                          ) : project?.audioUrl ? (
                            <audio controls src={project.audioUrl} className="w-full" />
                          ) : (
                            <div className="text-mist/70 flex items-center gap-2">
                              <AlertCircle className="w-5 h-5" /> Áudio indisponível
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium text-foam/85">
                            <Settings className="w-4 h-4" />
                            Informações adicionais para o vídeo (opcional)
                          </label>
                          <p className="text-xs text-mist">
                            Contexto livre (entra no título do vídeo no HeyGen). Comandos de fundo na mesma caixa,
                            separados por vírgula, ponto e vírgula ou linha — vale o último fundo:{' '}
                            <code className="mx-1 text-foam/85">bg_color:#0f172a</code>,
                            <code className="mx-1 text-foam/85">bg_image:https://...</code> ou{' '}
                            <code className="mx-1 text-foam/85">bg_video:https://...</code>. O personagem é o de Config.
                          </p>
                          <textarea
                            value={videoPromptInfo}
                            onChange={(e) => setVideoPromptInfo(e.target.value)}
                            placeholder="Ex.: bg_image:https://.../studio.jpg  ou  bg_color:#111827"
                            rows={3}
                            disabled={isGenerating}
                            className="input-field focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow resize-y text-sm"
                          />
                        </div>

                        <p className="text-xs text-mist">
                          {project?.audioSource === 'heygen'
                            ? 'O HeyGen gera narração e vídeo num passo com o personagem de Config. O render pode levar vários minutos.'
                            : 'O HeyGen gera o vídeo com o seu áudio e o personagem de Config. O render pode levar vários minutos — mantenha esta página aberta.'}
                        </p>
                        <button
                          onClick={handleGenerateVideo}
                          disabled={isGenerating}
                          className="btn-primary w-full py-4"
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
                          <div className="w-16 h-16 bg-ok/15 text-ok rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 className="w-8 h-8" />
                          </div>
                          <h3 className="text-2xl font-bold">
                            {project?.videoIsDemo ? 'Etapa concluída (demonstração)' : 'Vídeo concluído!'}
                          </h3>
                          <p className="text-mist mt-2 max-w-lg mx-auto">
                            {project?.videoIsDemo ? (
                              <>
                                Ainda não há integração real com HeyGen/Kling: o player abaixo mostra apenas um{' '}
                                <strong className="text-foam/85">vídeo de amostra</strong> para testar o fluxo. O seu
                                áudio e roteiro continuam guardados no projeto.
                              </>
                            ) : (
                              'Seu vídeo foi gerado e sincronizado com sucesso.'
                            )}
                          </p>
                        </div>

                        {project?.videoUrl ? (
                          <div className="rounded-2xl overflow-hidden border border-line bg-black ">
                            <video
                              src={project.videoUrl}
                              controls
                              playsInline
                              className="w-full aspect-video object-contain bg-black"
                            />
                            <div className="px-4 py-3 bg-ink text-foam flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <span className="text-sm">
                                {project.videoIsDemo ? 'Amostra (Big Buck Bunny)' : 'Pré-visualização'}
                              </span>
                              <a
                                href={project.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-signal hover:text-signal"
                              >
                                Abrir / baixar ficheiro →
                              </a>
                            </div>
                          </div>
                        ) : null}

                        <div className="text-center">
                          <button
                            onClick={handleReset}
                            className="mt-2 px-8 py-3 bg-panel-2 hover:bg-line text-foam/85 rounded-xl font-medium transition-colors inline-flex items-center gap-2"
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
                    <div className="panel p-6 ">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-mist mb-4">Etapas</h3>
                      <div className="space-y-4">
                        <StatusItem 
                          icon={<Sparkles className="w-4 h-4" />} 
                          label="Roteiro"
                          status={currentStep === 'idle' ? 'pending' : currentStep === 'generating_script' ? 'loading' : 'success'}
                          onClick={() => navigateWorkflowStep('script_review')}
                        />
                        <div className="w-0.5 h-4 bg-line ml-4"></div>
                        <StatusItem 
                          icon={<Mic className="w-4 h-4" />} 
                          label={
                            project?.audioSource === 'heygen'
                              ? 'Narração (HeyGen)'
                              : 'Áudio (ElevenLabs)'
                          }
                          status={['idle', 'generating_script', 'script_review'].includes(currentStep) ? 'pending' : currentStep === 'generating_audio' ? 'loading' : currentStep === 'error' && !project?.audioUrl && project?.audioSource !== 'heygen' ? 'pending' : currentStep === 'error' && project?.status === 'generating_audio' ? 'error' : 'success'}
                          onClick={() => navigateWorkflowStep('audio_review')}
                        />
                        <div className="w-0.5 h-4 bg-line ml-4"></div>
                        <StatusItem 
                          icon={<Video className="w-4 h-4" />} 
                          label="Vídeo (HeyGen)" 
                          status={['idle', 'generating_script', 'script_review', 'generating_audio', 'audio_review'].includes(currentStep) ? 'pending' : currentStep === 'generating_video' ? 'loading' : currentStep === 'completed' ? 'success' : 'error'}
                          onClick={() => navigateWorkflowStep('completed')}
                        />
                      </div>
                    </div>

                    {/* Generated Script Display (Only in later steps) */}
                    {project?.generatedScript && !['idle', 'generating_script', 'script_review'].includes(currentStep) && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-panel border border-line p-6 rounded-2xl "
                      >
                        <h3 className="text-sm font-bold uppercase tracking-wider text-mist mb-4 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Roteiro Aprovado
                        </h3>
                        <div className="text-sm text-foam/85 bg-ink-2 p-4 rounded-xl border border-line-soft max-h-48 overflow-y-auto whitespace-pre-wrap">
                          {project.generatedScript}
                        </div>
                      </motion.div>
                    )}

                    {/* Cost Estimation */}
                    {project?.cost && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-ok/10 border border-ok/30 p-6 rounded-2xl "
                      >
                        <h3 className="text-sm font-bold uppercase tracking-wider text-ok mb-4 flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          Custo Estimado
                        </h3>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between text-ok">
                            <span>Áudio ({project.cost.audioTokens} chars)</span>
                            <span className="font-medium">${project.cost.audioCost.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between text-ok">
                            <span>Vídeo (~{project.cost.videoSeconds}s)</span>
                            <span className="font-medium">${project.cost.videoCost.toFixed(4)}</span>
                          </div>
                          <div className="pt-3 border-t border-ok/30 flex justify-between text-ok font-bold">
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
                        className="bg-black rounded-2xl overflow-hidden  border border-line"
                      >
                        <video 
                          src={project.videoUrl} 
                          controls 
                          className="w-full aspect-video object-cover"
                        />
                        <div className="p-4 bg-ink text-foam">
                          <p className="text-sm font-medium">
                            {project.videoIsDemo ? 'Vídeo de demonstração' : 'Vídeo gerado'}
                          </p>
                          <a href={project.videoUrl} download className="text-xs text-signal hover:text-signal mt-1 inline-block">
                            Abrir / baixar
                          </a>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'translation' ? (
              <VideoTranslationTab user={user} />
            ) : activeTab === 'settings' ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl space-y-8"
              >
                <div>
                  <h2 className="font-display text-3xl font-bold tracking-tight">Config</h2>
                  <p className="text-mist mt-1">API keys e personagem do avatar — guardados na sua conta.</p>
                </div>

                <div className="rounded-2xl border border-signal/30 bg-signal/10 p-5 sm:p-6">
                  <div className="flex gap-4">
                    <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-signal/20 ring-1 ring-signal/30">
                      <DollarSign className="h-5 w-5 text-signal" />
                    </span>
                    <div>
                      <p className="font-display text-lg font-bold text-foam">
                        Você traz as APIs. O Studio corta o custo.
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-foam/85">
                        O trabalho é seu: criar e colar as chaves (HeyGen, ElevenLabs, Gemini/OpenAI). Em troca,
                        paga só o consumo direto das APIs — em média{' '}
                        <strong className="text-signal">até 60% mais barato</strong> do que produzir o mesmo
                        vídeo nas interfaces e planos do HeyGen e ferramentas similares.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 panel p-8 ">
                  {isKeysLoading && (
                    <div className="p-4 bg-ink-2 border border-line rounded-xl text-sm text-mist flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando chaves salvas...
                    </div>
                  )}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-signal" />
                      Roteiro (IA)
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">Gemini API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('gemini')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="password"
                          value={apiKeys.gemini}
                          onChange={(e) => updateApiKey('gemini', e.target.value)}
                          placeholder="AIza..."
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">GPT/OpenAI API Key (opcional, fallback)</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('openai')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="password"
                          value={apiKeys.openai}
                          onChange={(e) => updateApiKey('openai', e.target.value)}
                          placeholder="sk-..."
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                      <p className="text-xs text-mist">Se Gemini estiver preenchido, ele será priorizado.</p>
                    </div>
                  </div>

                  <div className="w-full h-px bg-panel-2 my-6"></div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Video className="w-5 h-5 text-signal" />
                      HeyGen — avatar e voz
                    </h3>
                    <p className="text-xs text-mist -mt-2">
                      Avatar e narração no fluxo padrão vêm do HeyGen. Escolha Avatar IV ou Avatar V abaixo.
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">HeyGen API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('heygen')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="password"
                          value={apiKeys.heygen}
                          onChange={(e) => updateApiKey('heygen', e.target.value)}
                          placeholder="Insira sua chave do HeyGen..."
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-sm font-medium text-foam/85">Personagem HeyGen</label>
                        <button
                          type="button"
                          onClick={() => void loadHeygenCharacters()}
                          disabled={isKeysLoading || heygenListLoading || !apiKeys.heygen?.trim()}
                          className="text-xs text-signal hover:text-signal-dim font-medium disabled:opacity-50"
                        >
                          {heygenListLoading ? 'A carregar…' : 'Carregar lista da API'}
                        </button>
                      </div>
                      <select
                        value={heygenPickSelectValue}
                        onChange={(e) => applyHeygenCharacterPick(e.target.value)}
                        disabled={isKeysLoading || heygenAvatars.length === 0}
                        className="input-field focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm bg-panel"
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
                        <p className="text-xs text-warm">{heygenListError}</p>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">ID do personagem (avatar)</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('heygenCharacterId')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="text"
                          value={apiKeys.heygenCharacterId}
                          onChange={(e) => updateApiKey('heygenCharacterId', e.target.value)}
                          placeholder="avatar_id ou look_id (Digital Twin para Avatar V)"
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">Motor</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('heygenEngine')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={isKeysLoading}
                          onClick={() => updateApiKey('heygenEngine', 'avatar_v')}
                          className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium border transition-colors ${
                            apiKeys.heygenEngine === 'avatar_v'
                              ? 'bg-signal text-signal-ink border-signal'
                              : 'bg-panel text-foam/85 border-line hover:bg-ink-2'
                          }`}
                        >
                          Avatar V
                        </button>
                        <button
                          type="button"
                          disabled={isKeysLoading}
                          onClick={() => updateApiKey('heygenEngine', 'avatar_iv')}
                          className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium border transition-colors ${
                            apiKeys.heygenEngine !== 'avatar_v'
                              ? 'bg-signal text-signal-ink border-signal'
                              : 'bg-panel text-foam/85 border-line hover:bg-ink-2'
                          }`}
                        >
                          Avatar IV
                        </button>
                      </div>
                      <p className="text-xs text-mist">
                        {apiKeys.heygenEngine === 'avatar_v'
                          ? 'Avatar V precisa de um look Digital Twin elegível. O servidor valida antes de gerar.'
                          : 'Avatar IV funciona com a maioria dos avatares.'}
                      </p>
                    </div>
                  </div>

                  <div className="w-full h-px bg-panel-2 my-6"></div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Mic className="w-5 h-5 text-mist" />
                      ElevenLabs — áudio (opcional)
                    </h3>
                    <p className="text-xs text-mist -mt-2">
                      Opcional. Só gera o ficheiro de voz; o avatar continua no HeyGen.
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">ElevenLabs API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('elevenlabs')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="password"
                          value={apiKeys.elevenlabs}
                          onChange={(e) => updateApiKey('elevenlabs', e.target.value)}
                          placeholder="sk_..."
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">ElevenLabs Voice ID</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('elevenlabsVoiceId')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="text"
                          value={apiKeys.elevenlabsVoiceId}
                          onChange={(e) => updateApiKey('elevenlabsVoiceId', e.target.value)}
                          placeholder="My Voices → copie o voice_id"
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="w-full h-px bg-panel-2 my-6"></div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Video className="w-5 h-5 text-mist" />
                      Outros
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foam/85">Kling API Key</label>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey('kling')}
                          className="text-xs text-signal hover:text-signal-dim inline-flex items-center gap-1"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          Como obter
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mist/70" />
                        <input
                          type="password"
                          value={apiKeys.kling}
                          onChange={(e) => updateApiKey('kling', e.target.value)}
                          placeholder="Insira sua chave do Kling..."
                          className="input-field pl-10 focus:ring-2 focus:ring-signal/25 focus:border-signal/50 outline-none transition-shadow text-sm"
                          disabled={isKeysLoading}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-8 p-4 bg-warn/10 border border-warn/30 rounded-xl flex gap-3 text-warn text-sm">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>
                      <strong>Aviso de Segurança:</strong> As chaves ficam no Firestore da sua conta. Para producao, o ideal e criptografar antes de salvar e acessar provedores por rotas server-side.
                    </p>
                  </div>
                </div>

                {helpModalKey && (
                  <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg panel p-6 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <h4 className="text-lg font-semibold text-foam">{KEY_HELP_CONTENT[helpModalKey].title}</h4>
                        <button
                          type="button"
                          onClick={() => setHelpModalKey(null)}
                          className="text-mist hover:text-foam/85"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <ol className="list-decimal list-inside space-y-2 text-sm text-foam/85">
                        {KEY_HELP_CONTENT[helpModalKey].steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <a
                        href={KEY_HELP_CONTENT[helpModalKey].link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-sm text-signal hover:text-signal-dim"
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
                  <h2 className="font-display text-3xl font-bold tracking-tight">Biblioteca</h2>
                  <p className="text-mist mt-1">Os seus vídeos e projetos.</p>
                </div>

                {isProjectsLoading ? (
                  <div className="panel p-6  flex items-center gap-2 text-mist">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    A carregar…
                  </div>
                ) : savedProjects.length === 0 ? (
                  <div className="panel p-6  text-mist">
                    Ainda não há projetos.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {savedProjects.map((item) => (
                      <div key={item.id} className="panel p-6  space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-foam">Projeto {item.id}</h3>
                            <p className="text-xs text-mist">{new Date(item.date).toLocaleString('pt-BR')}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded-full bg-panel-2 text-foam/85">
                            {item.status}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-mist">Input (Material Bruto)</p>
                          <div className="text-sm text-foam/85 bg-ink-2 p-3 rounded-lg whitespace-pre-wrap">
                            {item.rawMaterial}
                          </div>
                          {typeof item.targetVideoDurationSeconds === 'number' && item.targetVideoDurationSeconds > 0 ? (
                            <p className="text-xs text-mist">
                              Duração prevista: {item.targetVideoDurationSeconds} s
                            </p>
                          ) : null}
                        </div>

                        {item.promptInfo && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-mist">Notas para o vídeo (HeyGen)</p>
                            <div className="text-sm text-foam/85 bg-ink-2 p-3 rounded-lg whitespace-pre-wrap">
                              {item.promptInfo}
                            </div>
                          </div>
                        )}

                        {item.generatedScript && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-mist">Roteiro gerado</p>
                            <div className="text-sm text-foam/85 bg-ink-2 p-3 rounded-lg whitespace-pre-wrap">
                              {item.generatedScript}
                            </div>
                          </div>
                        )}

                        {(item.audioUrl || item.videoUrl) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            {item.audioUrl && (
                              <a href={item.audioUrl} target="_blank" rel="noreferrer" className="text-signal hover:text-signal-dim">
                                Abrir áudio gerado
                              </a>
                            )}
                            {item.videoUrl && (
                              <a href={item.videoUrl} target="_blank" rel="noreferrer" className="text-signal hover:text-signal-dim">
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

      <SiteFooter />
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
        status === 'pending' ? 'bg-panel-2 text-mist/70' :
        status === 'loading' ? 'bg-signal/15 text-signal' :
        status === 'error' ? 'bg-warm/15 text-warm' :
        'bg-ok/15 text-ok'
      }`}>
        {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> :
         status === 'success' ? <CheckCircle2 className="w-4 h-4" /> :
         status === 'error' ? <AlertCircle className="w-4 h-4" /> :
         icon}
      </div>
      <span className={`text-sm font-medium ${
        status === 'pending' ? 'text-mist' :
        status === 'loading' ? 'text-signal' :
        status === 'error' ? 'text-warm' :
        'text-ok'
      }`}>
        {label}
      </span>
    </button>
  );
}
