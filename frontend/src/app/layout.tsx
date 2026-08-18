import type { Metadata } from "next";
import "react-international-phone/style.css";
import "react-toastify/dist/ReactToastify.css";
import PortalToasts from "@/components/PortalToasts";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Swiftline Cargo Portal",
  description: "A portal provided by Swiftline Cargo for managing your shipments and tracking your orders.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
    shortcut: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <PortalToasts />
      </body>
    </html>
  );
}
