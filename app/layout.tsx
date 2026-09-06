import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/components/language-provider";

export const metadata: Metadata = {
  title: "HSE Radar — Оперативный центр",
  description: "Сроки, допуски, СИЗ и риски в одном рабочем пространстве.",
  icons:{icon:"/icon.svg",shortcut:"/icon.svg",apple:"/icon.svg"},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><LanguageProvider>{children}</LanguageProvider></body></html>;
}
