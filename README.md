# Studio — Gerador de videos com avatar

Studio e uma aplicacao Next.js para criar videos com avatar a partir de texto. O app combina roteiro com IA, voz, render HeyGen e armazenamento por utilizador no Firebase.

Powered by [BuildAI](https://buildai.dev.br/).

## Principais recursos

- **Roteiro com IA**: transforma texto, notas ou rascunhos em roteiro pronto para narracao usando Gemini ou OpenAI.
- **Avatar HeyGen**: gera video com avatar, usando a voz padrao do personagem e suporte a Avatar IV / Avatar V quando o look for elegivel.
- **Custo via APIs**: o utilizador configura as proprias APIs e paga o consumo direto, com proposta de ate 60% menos custo do que usar ferramentas fechadas equivalentes.
- **ElevenLabs opcional**: permite gerar ou enviar audio externo quando nao quiser usar a voz nativa do avatar.
- **Traducao de video**: upload de video, transcricao, traducao, TTS e sincronizacao com FFmpeg.
- **Historico por conta**: projetos, traducoes e configuracoes ficam associados ao utilizador autenticado.

## Stack

- Next.js 15 / React 19
- Tailwind CSS 4
- Firebase Auth, Firestore, Storage e App Hosting
- Firebase Admin SDK nas rotas server-side
- HeyGen API para avatar e render de video
- Gemini ou OpenAI para roteiro
- ElevenLabs para TTS opcional
- FFmpeg / FFprobe para processamento de video

## Requisitos

- Node.js 20+
- npm
- Projeto Firebase com:
  - Authentication com Google habilitado
  - Firestore
  - Storage
  - App Hosting, caso va publicar
- Chaves das APIs que pretende usar: HeyGen, Gemini/OpenAI e opcionalmente ElevenLabs.

## Configuracao local

Instale as dependencias:

```bash
npm install
```

Crie `.env.local` na raiz do projeto. Nao commite este arquivo.

Variaveis publicas do Firebase:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Variaveis server-side do Firebase Admin:

```bash
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
FIREBASE_ADMIN_STORAGE_BUCKET=
```

Em Firebase App Hosting, prefira os aliases `SERVICE_ACCOUNT_*`, porque alguns nomes `FIREBASE_*` sao reservados:

```bash
SERVICE_ACCOUNT_PROJECT_ID=
SERVICE_ACCOUNT_CLIENT_EMAIL=
SERVICE_ACCOUNT_PRIVATE_KEY=
SERVICE_ACCOUNT_STORAGE_BUCKET=
```

Variaveis opcionais:

```bash
ELEVENLABS_DEFAULT_VOICE_ID=
HEYGEN_DEFAULT_CHARACTER_ID=
HEYGEN_DEFAULT_CHARACTER_KIND=avatar
```

Rode o app:

```bash
npm run dev:fresh
```

## Scripts

```bash
npm run dev          # Next.js em desenvolvimento
npm run dev:fresh    # limpa .next e inicia o dev server
npm run build        # build de producao
npm run start        # inicia o build local
npm run lint         # ESLint
npm run deploy:firebase
```

## Deploy

O deploy usa Firebase App Hosting e Firestore Rules:

```bash
npm run build
npm run deploy:firebase
```

O script `deploy:firebase` publica:

- backend App Hosting
- regras do Firestore (`firestore.rules`)

## Como usar

1. Entre com Google.
2. Abra **Config** e preencha as APIs:
   - Gemini ou OpenAI para gerar roteiro
   - HeyGen API Key e avatar/look ID
   - ElevenLabs apenas se quiser voz externa
3. Em **Estudio**, cole o texto de origem.
4. Gere e revise o roteiro.
5. Escolha voz do avatar HeyGen ou audio externo.
6. Gere o video e acompanhe o status ate finalizar.

## Avatar V

Avatar V e opt-in por look na API da HeyGen. Para usar:

- selecione **Avatar V** em Config
- use um `look_id` elegivel, normalmente Digital Twin
- o servidor valida `GET /v3/avatars/looks/{look_id}` e exige `avatar_v` em `supported_api_engines`

Se o look nao for elegivel, use Avatar IV.

## Seguranca

- `.env*` esta no `.gitignore`; nao commite chaves.
- As chaves de APIs do utilizador ficam em Firestore sob `users/{uid}/settings/apiKeys`.
- Rotas server-side verificam `idToken` com Firebase Admin antes de acessar dados do utilizador.
- Firestore Rules limitam leitura/escrita ao proprio `uid`.

## Observacoes

- O projeto usa `output: 'standalone'` somente em producao para evitar conflitos entre `next dev` e artefatos de build.
- FFmpeg e FFprobe sao tratados como pacotes externos para preservar o caminho dos binarios em runtime.
- O fluxo de traducao pode consumir bastante disco temporario e tempo de processamento, dependendo do tamanho do video.
