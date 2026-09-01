import PublicHeader from "@/components/public/PublicHeader";
import PublicFooter from "@/components/public/PublicFooter";

export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-clip bg-[#F8FAFC]">
      <PublicHeader />
      <main className="w-full min-w-0 flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
