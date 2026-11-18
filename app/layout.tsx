import type { Metadata, Viewport } from "next";
import "./globals.css";
import FullscreenControl from "./components/FullscreenControl";

export const metadata: Metadata = {
  title: "Make your Muse",
  description: "손으로 형태를 만들고 감각을 조합해 나만의 Muse를 만나는 TAMBURINS 팝업.",
  appleWebApp: { capable: true, title: "Make Your MUSE", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}<FullscreenControl /></body>
    </html>
  );
}
