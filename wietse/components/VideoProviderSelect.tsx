"use client";

import { useEffect, useState } from "react";
import { Cloud, HardDrive, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  LOCAL_VIDEO_PROVIDER_STORAGE_KEY,
  VIDEO_PROVIDER_OPTIONS,
  type VideoProvider,
} from "@/lib/video-types";

interface VideoProviderSelectProps {
  value: VideoProvider;
  onChange: (provider: VideoProvider) => void;
  disabled?: boolean;
}

export function VideoProviderSelect({
  value,
  onChange,
  disabled,
}: VideoProviderSelectProps) {
  const [localOk, setLocalOk] = useState<boolean | null>(null);
  const [localDetail, setLocalDetail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (value !== "local") return;
    setChecking(true);
    fetch("/api/animate-video?health=local", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { ok?: boolean; model?: string; device?: string; message?: string }) => {
        setLocalOk(body.ok ?? false);
        setLocalDetail(
          body.ok
            ? `${body.model ?? "lokaal"} · ${body.device ?? "device"}`
            : body.message ?? "Server offline"
        );
      })
      .catch(() => {
        setLocalOk(false);
        setLocalDetail("Server niet bereikbaar — start: npm run local-video");
      })
      .finally(() => setChecking(false));
  }, [value]);

  const handleChange = (provider: VideoProvider) => {
    onChange(provider);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_VIDEO_PROVIDER_STORAGE_KEY, provider);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Video-engine</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(VIDEO_PROVIDER_OPTIONS) as VideoProvider[]).map((key) => {
          const opt = VIDEO_PROVIDER_OPTIONS[key];
          const active = value === key;
          const Icon = key === "local" ? HardDrive : Cloud;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => handleChange(key)}
              className={`rounded-xl border-2 p-3 text-left transition-colors ${
                active
                  ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                  : "border-gray-200 bg-white hover:border-violet-200"
              } disabled:opacity-50`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-violet-600" />
                <span className="text-sm font-semibold text-violet-950">
                  {opt.label}
                </span>
              </div>
              <p className="mt-1 text-xs leading-snug text-violet-800/80">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>
      {value === "local" && (
        <p
          className={`flex items-center gap-1.5 text-xs ${
            localOk ? "text-green-700" : localOk === false ? "text-amber-700" : "text-muted-foreground"
          }`}
        >
          {checking ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Server controleren...
            </>
          ) : localOk ? (
            <>Lokale server actief — {localDetail}</>
          ) : (
            <>
              {localDetail ?? "Start de server: npm run local-video"}
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function loadStoredVideoProvider(): VideoProvider {
  if (typeof window === "undefined") return "replicate";
  const stored = localStorage.getItem(LOCAL_VIDEO_PROVIDER_STORAGE_KEY);
  return stored === "local" ? "local" : "replicate";
}
