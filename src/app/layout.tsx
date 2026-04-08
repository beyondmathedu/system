import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Beyond Math 管理系統",
    template: "%s | Beyond Math 管理系統",
  },
  description: "Beyond Math Education Centre 管理系統",
  icons: {
    icon: [{ url: "/icon.png?v=20260408", type: "image/png" }],
    shortcut: ["/icon.png?v=20260408"],
    apple: [{ url: "/icon.png?v=20260408" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
