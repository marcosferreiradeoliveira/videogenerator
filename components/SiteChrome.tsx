'use client';

import React from 'react';
import Image from 'next/image';
import { LogOut } from 'lucide-react';
import buildAiLogo from '@/lib/assets/buildai-logo-dark.png';

const YEAR = new Date().getFullYear();

export function PoweredByBuildAI({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://buildai.dev.br/"
      target="_blank"
      rel="noopener noreferrer"
      className={`flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 transition-opacity hover:opacity-90 ${className}`}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">Powered by</span>
      <Image
        src={buildAiLogo}
        alt="BuildAI"
        height={48}
        className="h-10 w-auto sm:h-12"
        priority={false}
      />
    </a>
  );
}

export function SiteHeader({
  variant = 'marketing',
  onSignIn,
  onSignOut,
  userLabel,
  userEmail,
  userPhotoUrl,
}: {
  variant?: 'marketing' | 'app';
  onSignIn?: () => void;
  onSignOut?: () => void;
  userLabel?: string;
  userEmail?: string;
  userPhotoUrl?: string | null;
}) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header className="relative z-30 border-b border-line/80 bg-ink-2/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-8 min-w-0">
          <div className="flex items-baseline gap-2 shrink-0">
            <span className="font-display text-lg font-extrabold tracking-tight text-foam">Studio</span>
            <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-[0.18em] text-signal">
              Avatares
            </span>
          </div>

          {variant === 'marketing' ? (
            <nav className="hidden md:flex items-center gap-6 text-sm text-mist">
              <button type="button" onClick={() => scrollTo('recursos')} className="hover:text-foam transition-colors">
                Recursos
              </button>
              <button type="button" onClick={() => scrollTo('custo')} className="hover:text-foam transition-colors">
                Custo
              </button>
              <button type="button" onClick={() => scrollTo('fluxo')} className="hover:text-foam transition-colors">
                Fluxo
              </button>
              <button type="button" onClick={() => scrollTo('entrar')} className="hover:text-foam transition-colors">
                Entrar
              </button>
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {variant === 'marketing' && onSignIn ? (
            <button type="button" onClick={onSignIn} className="btn-primary !py-2 !px-4 text-xs sm:text-sm">
              Continuar com Google
            </button>
          ) : null}

          {variant === 'app' ? (
            <>
              <div className="hidden sm:flex flex-col items-end min-w-0 max-w-[10rem]">
                <span className="text-xs font-medium text-foam truncate w-full text-right">
                  {userLabel || 'Utilizador'}
                </span>
                {userEmail ? <span className="text-[11px] text-mist truncate w-full text-right">{userEmail}</span> : null}
              </div>
              {userPhotoUrl ? (
                <img
                  src={userPhotoUrl}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover ring-1 ring-line"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-signal/15 text-signal flex items-center justify-center text-xs font-semibold">
                  {(userLabel || userEmail || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              {onSignOut ? (
                <button type="button" onClick={onSignOut} className="btn-ghost !py-2 !px-3 text-xs" title="Sair">
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-20 border-t border-line/80 bg-ink-2/60">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-display text-lg font-extrabold text-foam">Studio</p>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Produção de vídeo com avatar: roteiro, voz e render num único fluxo.
            </p>
          </div>
          <div>
            <p className="label-caps mb-3">Produto</p>
            <ul className="space-y-2 text-sm text-mist">
              <li>Até 60% mais barato via APIs</li>
              <li>Geração com avatar</li>
              <li>Voz HeyGen ou ElevenLabs</li>
              <li>Tradução de vídeo</li>
            </ul>
          </div>
          <div>
            <p className="label-caps mb-3">Integrações</p>
            <ul className="space-y-2 text-sm text-mist">
              <li>HeyGen</li>
              <li>ElevenLabs</li>
              <li>Gemini / OpenAI</li>
              <li>Firebase</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-line/60 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-mist/80">© {YEAR} Studio. Todos os direitos reservados.</p>
          <PoweredByBuildAI className="sm:justify-end" />
        </div>
      </div>
    </footer>
  );
}
