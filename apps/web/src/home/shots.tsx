import { SHOTS } from "../site.ts";

/** A screenshot from site.ts by file name, framed in the TV palette. Nothing renders if it is not listed. */
export function Shot({ file, className }: { file: string; className?: string }) {
  const s = SHOTS.find((x) => x.src.endsWith(`/${file}`));
  if (!s) return null;
  return (
    <figure className={`hm-shot${className ? ` ${className}` : ""}`}>
      <img src={s.src} alt={s.alt} width={s.width} height={s.height} loading="lazy" decoding="async" />
      <figcaption>{s.caption}</figcaption>
    </figure>
  );
}
