import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight } from "lucide-react";
import "@fontsource/space-grotesk/latin-700.css";

import { LogoIcon, Wordmark } from "@/components/Logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isTauri } from "@/lib/backend";

/** The models Murmur runs, with their authors and licences (docs/design/DESIGN.md › Quant a). */
const MODELS = [
  {
    role: "Transcripció",
    name: "Conformer català i castellà",
    author: "Projecte AINA (BSC), a partir d'un model d'NVIDIA",
    license: "CC BY 4.0",
    url: "https://huggingface.co/projecte-aina/stt_ca-es_conformer_transducer_large",
  },
  {
    role: "Transcripció en anglès",
    name: "Parakeet TDT-CTC 110M",
    author: "NVIDIA",
    license: "CC BY 4.0",
    url: "https://huggingface.co/nvidia/parakeet-tdt_ctc-110m",
  },
  {
    role: "Transcripció final",
    name: "Whisper large-v3-turbo",
    author: "OpenAI",
    license: "MIT",
    url: "https://huggingface.co/openai/whisper-large-v3-turbo",
  },
  { role: "Detecció de veu", name: "Silero VAD", author: "Silero", license: "MIT", url: "https://github.com/snakers4/silero-vad" },
  {
    role: "Parlants",
    name: "TitaNet small",
    author: "NVIDIA NeMo",
    license: "Apache 2.0",
    url: "https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/titanet_small",
  },
  {
    role: "Torns de paraula",
    name: "Segmentation 3.0",
    author: "pyannote",
    license: "MIT",
    url: "https://huggingface.co/pyannote/segmentation-3.0",
  },
  {
    role: "Verificació de parlants",
    name: "ERes2Net",
    author: "3D-Speaker (Alibaba)",
    license: "Apache 2.0",
    url: "https://github.com/modelscope/3D-Speaker",
  },
  {
    role: "Puntuació i majúscules",
    name: "Fullstop català",
    author: "Softcatalà",
    license: "Llicència no indicada",
    url: "https://huggingface.co/softcatala/fullstop-catalan-punctuation-prediction",
  },
  {
    role: "Resum i portada",
    name: "Gemma 4 E4B",
    author: "Google",
    license: "Apache 2.0",
    url: "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf",
  },
];

const TOOLS = [
  { name: "sherpa-onnx", license: "Apache 2.0", url: "https://github.com/k2-fsa/sherpa-onnx" },
  { name: "ONNX Runtime", license: "MIT", url: "https://github.com/microsoft/onnxruntime" },
  { name: "Tokenizers (Hugging Face)", license: "Apache 2.0", url: "https://github.com/huggingface/tokenizers" },
  { name: "llama.cpp", license: "MIT", url: "https://github.com/ggml-org/llama.cpp" },
  { name: "whisper.cpp", license: "MIT", url: "https://github.com/ggml-org/whisper.cpp" },
  { name: "Tauri", license: "MIT, Apache 2.0", url: "https://github.com/tauri-apps/tauri" },
  { name: "Cancel·lació d'eco WebRTC (sonora)", license: "BSD-3-Clause", url: "https://crates.io/crates/sonora" },
  { name: "Opus", license: "BSD-3-Clause", url: "https://opus-codec.org/license/" },
  { name: "SQLite", license: "Domini públic", url: "https://sqlite.org/copyright.html" },
  { name: "React", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "Radix UI i shadcn/ui", license: "MIT", url: "https://github.com/shadcn-ui/ui" },
  { name: "Tiptap", license: "MIT", url: "https://github.com/ueberdosis/tiptap" },
  { name: "docx (exportació a Word)", license: "MIT", url: "https://github.com/dolanmiu/docx" },
  { name: "Icones Lucide", license: "ISC", url: "https://github.com/lucide-icons/lucide" },
  { name: "Space Grotesk", license: "SIL OFL 1.1", url: "https://github.com/floriankarsten/space-grotesk" },
];

const open = (url: string) => (isTauri() ? openUrl(url) : Promise.resolve(window.open(url, "_blank"))).catch(() => {});

function ExternalLink({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => open(url)} className={className}>
      {children}
    </button>
  );
}

export function AboutDialog({ open: visible, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [allLicenses, setAllLicenses] = useState(false);
  useEffect(() => {
    if (visible && isTauri()) getVersion().then(setVersion).catch(() => {});
    if (!visible) setAllLicenses(false);
  }, [visible]);

  return (
    <Dialog open={visible} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-[90vh] gap-0 overflow-y-auto rounded-xl p-0 sm:max-w-[720px]"
      >
        <div className="flex flex-col items-center px-12 pt-10 text-center">
          <LogoIcon size={104} shadow />
          <DialogTitle className="sr-only">Quant a Murmur</DialogTitle>
          <Wordmark className="mt-[18px]" />
          <div className="mt-2 text-[13px] text-muted-foreground">{version ? `Versió ${version}` : "\u00a0"}</div>
          <DialogDescription className="mt-3.5 max-w-[460px] text-[15px] leading-normal text-foreground">
            Transcripció de reunions en directe, amb el català al centre. Tot es processa en aquest Mac: l'àudio i el text no surten mai
            de l'ordinador. Local vol dir privat.
          </DialogDescription>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {["Res surt d'aquest Mac", "Sense núvol ni comptes", "Català i castellà"].map((t) => (
              <span key={t} className="rounded-full bg-mm-fill-subtle px-2.5 py-1 text-[12px] font-medium">
                {t}
              </span>
            ))}
          </div>
        </div>

        <section aria-labelledby="oss-h" className="mx-10 mt-7 overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-mm-fill-subtle px-[18px] pb-2.5 pt-3.5">
            <h2 id="oss-h" className="text-[13px] font-semibold">
              Models i eines de codi obert
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Murmur existeix gràcies a aquests projectes. Gràcies a tothom qui hi contribueix.</p>
          </div>
          {MODELS.map((m) => (
            <div key={m.role} className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border px-[18px] py-2.5 text-[13px]">
              <span className="text-[12px] text-muted-foreground">{m.role}</span>
              <span className="min-w-0 font-medium">
                {m.name} <span className="font-normal text-muted-foreground">· {m.author}</span>
              </span>
              <ExternalLink url={m.url} className="flex items-center gap-0.5 text-[12px] text-mm-link hover:underline">
                {m.license} <ArrowUpRight className="size-3" aria-hidden />
              </ExternalLink>
            </div>
          ))}
          {allLicenses &&
            TOOLS.map((t) => (
              <div key={t.name} className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border px-[18px] py-2 text-[13px]">
                <span className="text-[12px] text-muted-foreground">Eina</span>
                <span className="min-w-0 font-medium">{t.name}</span>
                <ExternalLink url={t.url} className="flex items-center gap-0.5 text-[12px] text-mm-link hover:underline">
                  {t.license} <ArrowUpRight className="size-3" aria-hidden />
                </ExternalLink>
              </div>
            ))}
          <div className="px-[18px] py-2.5">
            <button
              type="button"
              aria-expanded={allLicenses}
              onClick={() => setAllLicenses((v) => !v)}
              className="text-[12px] font-medium underline underline-offset-[3px]"
            >
              {allLicenses ? "Amaga les eines" : "Veure totes les llicències i dependències"}
            </button>
          </div>
        </section>

        <footer className="mt-8 flex items-center gap-3 border-t border-border px-10 py-4">
          <div className="flex-1">
            <div className="text-[13px]">Fet a Barcelona per Quico Domingo</div>
            <div className="text-[12px] text-muted-foreground">© 2026</div>
          </div>
          <ExternalLink
            url="https://quicodomingo.com"
            className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium hover:bg-mm-fill-subtle"
          >
            quicodomingo.com <ArrowUpRight className="size-3" aria-hidden />
          </ExternalLink>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
