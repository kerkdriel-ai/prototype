"use client";

import Link from "next/link";
import { Sparkles, Upload, MapPin, BookOpen } from "lucide-react";
import { LinkButton } from "@/components/LinkButton";

export function Header() {
  return (
    <header className="border-b bg-gradient-to-r from-amber-50 via-orange-50 to-pink-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 text-white shadow-md">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-orange-900">Tekening Animator</h1>
            <p className="text-xs text-orange-700/70">Breng tekeningen tot leven</p>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          <LinkButton href="/upload" variant="outline" size="sm" className="rounded-full">
            <Upload className="mr-1 h-4 w-4" />
            Upload
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}

export function PageShell({
  children,
  title,
  subtitle,
}: {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/50 to-white">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {(title || subtitle) && (
          <div className="mb-8 text-center">
            {title && (
              <h2 className="text-3xl font-bold text-orange-900">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-2 text-orange-700/80">{subtitle}</p>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export function StreetViewLink({ drawingId }: { drawingId: string }) {
  return (
    <LinkButton href={`/streetview/${drawingId}`} variant="outline" size="sm" className="rounded-full">
      <MapPin className="mr-1 h-4 w-4" />
      Street View
    </LinkButton>
  );
}

export function ScriptLink({
  drawingId,
  active,
}: {
  drawingId: string;
  active?: boolean;
}) {
  return (
    <LinkButton
      href={`/script/${drawingId}`}
      variant={active ? "default" : "outline"}
      size="sm"
      className={
        active
          ? "rounded-full bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:opacity-90"
          : "rounded-full"
      }
    >
      <BookOpen className="mr-1 h-4 w-4" />
      Animatiescript
    </LinkButton>
  );
}
