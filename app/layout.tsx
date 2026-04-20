import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'NewsGen AI — Vídeos de telejornal com IA',
  description:
    'Transforme material bruto em roteiro, narração com voz sintética e vídeo com avatar — num único fluxo.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
