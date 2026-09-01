import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HSE Radar — Оперативный центр",
  description: "Сроки, допуски, СИЗ и риски в одном рабочем пространстве.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
