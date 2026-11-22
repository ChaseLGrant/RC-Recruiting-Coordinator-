"use client";

import { useState } from "react";

// Shrinks phone photos in the browser before upload (fast on gym Wi-Fi, and
// under the server's upload limit). Text on a roster stays sharp at 2000px.
const MAX_SIDE = 2000;

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // the server converts anything the browser couldn't
  }
}

export function PhotoPicker({ name }: { name: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <label className="block cursor-pointer border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-[var(--team-primary)]">
      <input
        type="file"
        name={name}
        accept="image/*"
        multiple
        className="sr-only"
        onChange={async (e) => {
          const input = e.currentTarget;
          const files = Array.from(input.files ?? []).slice(0, 6);
          if (files.length === 0) return setLabel(null);
          setBusy(true);
          const small = await Promise.all(files.map(shrink));
          try {
            const dt = new DataTransfer();
            small.forEach((f) => dt.items.add(f));
            input.files = dt.files;
          } catch {
            /* older browsers: upload the originals */
          }
          setBusy(false);
          setLabel(`${files.length} photo${files.length > 1 ? "s" : ""} ready`);
        }}
      />
      <span className="font-display block text-2xl font-extrabold uppercase">{busy ? "Getting photos ready…" : label ?? "Take or choose photos"}</span>
      <span className="mt-1 block text-xs text-slate-500">A roster, showcase program, lineup card or your handwritten list. Up to 6 pages.</span>
    </label>
  );
}
