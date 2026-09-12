import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>설정집 체크</title>
      </head>
      <body className="bg-[var(--card)] text-[var(--foreground)] antialiased">
        {children}
      </body>
    </html>
  );
}
