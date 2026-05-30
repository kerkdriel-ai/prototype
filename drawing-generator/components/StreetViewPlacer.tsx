"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { MapPin, Download, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import type { Part, StreetViewScene } from "@/types/drawing";
import { downloadDataUrl } from "@/lib/export";

interface StreetViewPlacerProps {
  parts: Part[];
  originalImage: string;
  width: number;
  height: number;
  initialScene?: StreetViewScene;
  onSave: (scene: StreetViewScene) => void;
}

const DEFAULT_SCENE: StreetViewScene = {
  lat: 52.3676,
  lng: 4.9041,
  heading: 0,
  pitch: 0,
  zoom: 1,
  scale: 1,
  partPositions: {},
};

export function StreetViewPlacer({
  parts,
  initialScene,
  onSave,
}: StreetViewPlacerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const panoramaInstanceRef = useRef<google.maps.StreetViewPanorama | null>(
    null
  );

  const [scene, setScene] = useState<StreetViewScene>(
    initialScene ?? DEFAULT_SCENE
  );
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(
    parts[0]?.id ?? null
  );

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey || !mapRef.current || !panoramaRef.current) {
      return;
    }

    setOptions({ key: apiKey, v: "weekly" });

    Promise.all([importLibrary("maps"), importLibrary("streetView")])
      .then(() => {
        const map = new google.maps.Map(mapRef.current!, {
          center: { lat: scene.lat, lng: scene.lng },
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
        });
        mapInstanceRef.current = map;

        const panorama = new google.maps.StreetViewPanorama(
          panoramaRef.current!,
          {
            position: { lat: scene.lat, lng: scene.lng },
            pov: { heading: scene.heading, pitch: scene.pitch },
            zoom: scene.zoom,
            addressControl: false,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
          }
        );
        panoramaInstanceRef.current = panorama;
        map.setStreetView(panorama);

        panorama.addListener("position_changed", () => {
          const pos = panorama.getPosition();
          if (pos) {
            setScene((s) => ({ ...s, lat: pos.lat(), lng: pos.lng() }));
          }
        });

        panorama.addListener("pov_changed", () => {
          const pov = panorama.getPov();
          setScene((s) => ({
            ...s,
            heading: pov.heading ?? 0,
            pitch: pov.pitch ?? 0,
          }));
        });

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          panorama.setPosition(e.latLng);
          setScene((s) => ({
            ...s,
            lat: e.latLng!.lat(),
            lng: e.latLng!.lng(),
          }));
        });

        setLoaded(true);
      })
      .catch(() => setError("Google Maps laden mislukt."));
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getPartPosition = (partId: string) => {
    return (
      scene.partPositions[partId] ?? {
        x: 50,
        y: 50,
      }
    );
  };

  const handlePartDrag = (partId: string, x: number, y: number) => {
    setScene((s) => ({
      ...s,
      partPositions: {
        ...s.partPositions,
        [partId]: { x, y },
      },
    }));
  };

  const handleSave = () => onSave(scene);

  const handleScreenshot = useCallback(() => {
    if (!overlayRef.current) return;
    const canvas = document.createElement("canvas");
    const rect = overlayRef.current.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d")!;

    if (panoramaRef.current) {
      const panoCanvas = panoramaRef.current.querySelector("canvas");
      if (panoCanvas) {
        ctx.drawImage(panoCanvas, 0, 0, canvas.width, canvas.height);
      }
    }

    parts.forEach((part) => {
      const pos = getPartPosition(part.id);
      const img = new Image();
      img.src = part.imageDataUrl;
      const w = part.bbox.width * scene.scale * 0.5;
      const h = part.bbox.height * scene.scale * 0.5;
      const x = (pos.x / 100) * canvas.width - w / 2;
      const y = (pos.y / 100) * canvas.height - h / 2;
      ctx.drawImage(img, x, y, w, h);
    });

    downloadDataUrl(canvas.toDataURL("image/png"), "streetview-scene.png");
  }, [parts, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error || !apiKey) {
    return (
      <div className="rounded-2xl border-2 border-orange-200 bg-orange-50 p-8 text-center">
        <MapPin className="mx-auto mb-4 h-12 w-12 text-orange-400" />
        <h3 className="text-lg font-bold text-orange-900">
          {error ?? "Google Maps API key niet geconfigureerd."}
        </h3>
        <p className="mt-2 text-sm text-orange-700/70">
          Voeg <code className="rounded bg-white px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> toe
          aan je .env.local bestand.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div
          ref={mapRef}
          className="h-[200px] w-full rounded-2xl border-2 border-orange-200"
        />
        <div className="relative overflow-hidden rounded-2xl border-4 border-orange-200">
          <div
            ref={panoramaRef}
            className="h-[400px] w-full"
          />
          <div
            ref={overlayRef}
            className="pointer-events-none absolute inset-0"
          >
            {loaded &&
              parts.map((part) => {
                const pos = getPartPosition(part.id);
                const selected = selectedPartId === part.id;
                return (
                  <div
                    key={part.id}
                    className={`pointer-events-auto absolute cursor-move transition-shadow ${
                      selected ? "ring-4 ring-pink-500 ring-offset-2" : ""
                    }`}
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: `translate(-50%, -50%) scale(${scene.scale * 0.5}) rotate(${scene.heading * 0.05}deg)`,
                      zIndex: selected ? 10 : 1,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelectedPartId(part.id);
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const startPos = { ...pos };

                      const onMove = (me: MouseEvent) => {
                        const parent = overlayRef.current;
                        if (!parent) return;
                        const rect = parent.getBoundingClientRect();
                        const dx = ((me.clientX - startX) / rect.width) * 100;
                        const dy = ((me.clientY - startY) / rect.height) * 100;
                        handlePartDrag(
                          part.id,
                          Math.max(0, Math.min(100, startPos.x + dx)),
                          Math.max(0, Math.min(100, startPos.y + dy))
                        );
                      };

                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };

                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                    onClick={() => setSelectedPartId(part.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={part.imageDataUrl}
                      alt={part.label}
                      className="max-h-32 object-contain drop-shadow-lg"
                      draggable={false}
                    />
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-orange-900">Plaatsing</h3>

        <div className="space-y-2">
          <Label>Locatie (klik op kaart)</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.0001"
              value={scene.lat}
              onChange={(e) =>
                setScene((s) => ({ ...s, lat: parseFloat(e.target.value) }))
              }
              placeholder="Latitude"
            />
            <Input
              type="number"
              step="0.0001"
              value={scene.lng}
              onChange={(e) =>
                setScene((s) => ({ ...s, lng: parseFloat(e.target.value) }))
              }
              placeholder="Longitude"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Schaal: {scene.scale.toFixed(1)}x</Label>
          <Slider
            min={0.2}
            max={3}
            step={0.1}
            value={[scene.scale]}
            onValueChange={(v) => {
              const val = Array.isArray(v) ? v[0] : v;
              setScene((s) => ({ ...s, scale: val as number }));
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>Heading: {Math.round(scene.heading)}°</Label>
          <Slider
            min={0}
            max={360}
            step={1}
            value={[scene.heading]}
            onValueChange={(v) => {
              const val = Array.isArray(v) ? v[0] : v;
              setScene((s) => ({ ...s, heading: val as number }));
              panoramaInstanceRef.current?.setPov({
                heading: val as number,
                pitch: scene.pitch,
              });
            }}
          />
        </div>

        <div className="space-y-1">
          <Label>Onderdelen</Label>
          {parts.map((part) => (
            <button
              key={part.id}
              type="button"
              onClick={() => setSelectedPartId(part.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                selectedPartId === part.id
                  ? "bg-pink-100 font-medium"
                  : "hover:bg-orange-50"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={part.imageDataUrl}
                alt={part.label}
                className="h-8 w-8 object-contain"
              />
              {part.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleSave} className="rounded-full">
            <Save className="mr-2 h-4 w-4" /> Opslaan
          </Button>
          <Button
            variant="outline"
            onClick={handleScreenshot}
            className="rounded-full"
          >
            <Download className="mr-2 h-4 w-4" /> Screenshot
          </Button>
        </div>
      </div>
    </div>
  );
}
