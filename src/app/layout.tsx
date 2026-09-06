import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AuthProvider from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
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
    default: "Assessment Brain",
    template: "%s · Assessment Brain",
  },
  description:
    "AI-assisted assessment creation, evaluation, and grading, with a teacher in the loop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AuthProvider>
          <NavBar />
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
            {children}
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-subtle">
              Assessment Brain — AI Decoder Academy. Marks are produced by rubric-based
              evaluation and confirmed by teachers.
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
