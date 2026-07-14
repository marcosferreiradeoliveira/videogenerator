import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studio — Vídeos com avatar',
  description:
    'Do texto ao vídeo com avatar: roteiro, voz e render HeyGen num único fluxo profissional.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
