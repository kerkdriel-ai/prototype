"use client";

import { useCallback, useState } from "react";
import { Upload, Camera, ImageIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCEPTED_TYPES, MAX_FILE_SIZE } from "@/lib/image-utils";

interface UploadZoneProps {
  onUpload: (file: File, dataUrl: string) => void;
  loading?: boolean;
}

export function UploadZone({ onUpload, loading }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Alleen JPG, PNG of WebP toegestaan.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("Bestand is te groot (max 4MB).");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => onUpload(file, reader.result as string);
      reader.readAsDataURL(file);
    },
    [onUpload]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="mx-auto max-w-xl">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative flex min-h-[320px] flex-col items-center justify-center rounded-3xl border-4 border-dashed p-8 transition-all ${
          dragOver
            ? "border-pink-400 bg-pink-50 scale-[1.02]"
            : "border-orange-200 bg-white hover:border-orange-300"
        }`}
      >
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-pink-100">
          <ImageIcon className="h-10 w-10 text-orange-500" />
        </div>
        <h3 className="text-xl font-bold text-orange-900">
          Sleep een tekening hierheen
        </h3>
        <p className="mt-2 text-center text-sm text-orange-700/70">
          Of kies een foto van een kindertekening
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <label>
            <input
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <span
              className={cn(
                buttonVariants({ size: "lg" }),
                "cursor-pointer rounded-full bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90"
              )}
            >
              <Upload className="mr-2 h-5 w-5" />
              Kies bestand
            </span>
          </label>

          <label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "cursor-pointer rounded-full"
              )}
            >
              <Camera className="mr-2 h-5 w-5" />
              Maak foto
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-4 text-sm font-medium text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
