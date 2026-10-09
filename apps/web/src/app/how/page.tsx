import { EmptyState } from "@/components/ui";
import { Shell } from "@/components/Shell";
import { docsDir, listDocs } from "@/server/docs";

export const dynamic = "force-dynamic";

/** /how renders every /docs/*.md verbatim, read at request time. */
export default function HowPage() {
  const docs = listDocs();
  const dir = docsDir();
  return (
    <Shell current="/how">
      <h1 className="text-lg text-tunnel">how</h1>
      {docs.length === 0 ? (
        <EmptyState title="No docs yet." detail={dir ? `${dir} has no .md files.` : "The /docs directory was not found next to pnpm-workspace.yaml."} />
      ) : (
        <>
          <nav aria-label="Docs" className="flex flex-wrap gap-2 text-xs">
            {docs.map((d) => (
              <a key={d.slug} href={`#${d.slug}`} className="inline-flex min-h-hit items-center rounded-full border border-border bg-panel px-3 text-text">
                {d.title}
              </a>
            ))}
          </nav>
          {docs.map((d) => (
            <article key={d.slug} id={d.slug} data-testid="doc" className="doc rounded-xl border border-border bg-panel px-4 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted">docs/{d.file}</div>
              <div dangerouslySetInnerHTML={{ __html: d.html }} />
            </article>
          ))}
        </>
      )}
    </Shell>
  );
}
