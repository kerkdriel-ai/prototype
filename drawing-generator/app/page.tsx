import { PageShell } from "@/components/Header";
import { Gallery } from "@/components/Gallery";
import { LinkButton } from "@/components/LinkButton";
import { Upload } from "lucide-react";

export default function HomePage() {
  return (
    <PageShell
      title="Mijn tekeningen"
      subtitle="Upload, bewerk en animeer kindertekeningen"
    >
      <div className="mb-6 flex justify-center">
        <LinkButton href="/upload" size="lg" className="rounded-full bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90">
          <Upload className="mr-2 h-5 w-5" />
          Nieuwe tekening
        </LinkButton>
      </div>
      <Gallery />
    </PageShell>
  );
}
