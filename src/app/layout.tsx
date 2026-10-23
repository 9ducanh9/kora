import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kora — Prompt-to-AWS-Architecture',
  description: 'AI-controllable AWS architecture diagram editor. Convert natural language into real, deterministic, editable canvas objects.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
