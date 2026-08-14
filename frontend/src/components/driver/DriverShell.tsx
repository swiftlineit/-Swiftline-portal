"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { FiClipboard, FiLogOut, FiUser } from "react-icons/fi";
import { logout } from "@/lib/auth";
import SessionTimeoutGuard from "@/components/SessionTimeoutGuard";
import { loadProfileImageUrl } from "@/lib/profile";

export default function DriverShell({ name, subrole, children }: { name: string; subrole: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileImage, setProfileImage] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void loadProfileImageUrl().then((url) => { objectUrl = url; if (active) setProfileImage(url); }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  async function signOut() { await logout(); router.replace("/"); }

  const workNav = subrole === "SUPERVISOR"
    ? [{ href: "/driver", label: "Dispatch", icon: FiClipboard }, { href: "/driver/pod", label: "POD Review", icon: FiClipboard }]
    : subrole === "DELIVERY_PERSON"
      ? [{ href: "/driver/deliveries", label: "Deliveries", icon: FiClipboard }]
      : [{ href: "/driver", label: "Pickups", icon: FiClipboard }];
  const nav = [...workNav, { href: "/driver/profile", label: "Profile", icon: FiUser }];

  return <div className="min-h-dvh bg-slate-100 pb-20 text-slate-950 md:pb-0">
    {/* Mounted inside the shell so it only ever runs for a signed-in user. */}
    <SessionTimeoutGuard />
    <header className="sticky top-0 z-30 border-b border-blue-900/30 bg-[#0D1282] text-white shadow-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Image src="/Slogo.png" alt="Swiftline" width={40} height={40} className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{name || "Delivery team"}</p><p className="text-[11px] font-medium uppercase tracking-wider text-blue-100">{subrole === "SUPERVISOR" ? "Delivery supervisor" : subrole === "DELIVERY_PERSON" ? "International delivery person" : "Pickup driver"}</p></div>
        <nav className="hidden items-center gap-2 md:flex">{nav.map((item) => <Link key={item.href} href={item.href} className={`rounded-full px-4 py-2 text-sm font-semibold ${pathname === item.href ? "bg-white text-[#0D1282]" : "text-white hover:bg-white/10"}`}>{item.label}</Link>)}</nav>
        <button onClick={() => void signOut()} aria-label="Log out" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><FiLogOut /></button>
        {profileImage ? <Image src={profileImage} alt="Profile" width={40} height={40} unoptimized className="h-10 w-10 rounded-full border-2 border-white/70 object-cover" /> : null}
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-5 sm:py-6">{children}</main>
    <nav className={`fixed inset-x-0 bottom-0 z-30 grid h-16 ${nav.length === 3 ? "grid-cols-3" : "grid-cols-2"} border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden`}>
      {nav.map((item) => { const Icon = item.icon; const active = pathname === item.href; return <Link key={item.href} href={item.href} className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold ${active ? "text-[#0D1282]" : "text-slate-500"}`}><Icon className="h-5 w-5" />{item.label}</Link>; })}
    </nav>
  </div>;
}
