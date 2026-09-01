import PublicHeader from "@/components/public/PublicHeader";
import PublicFooter from "@/components/public/PublicFooter";
import PublicTrackBackButton from "@/components/tracking/PublicTrackBackButton";

/**
 * Chrome for the one part of the portal that signed-out people see.
 *
 * Standalone rather than the dashboard shell: a consignee has no account, so a
 * sidebar of links they cannot open would be noise at best. Everything here is
 * a plain link, so the page renders and navigates with no JavaScript at all.
 */
export default function PublicTrackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-clip bg-slate-50">
      <PublicHeader />
      <main className="w-full min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <PublicTrackBackButton />
        </div>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}