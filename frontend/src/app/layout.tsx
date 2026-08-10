import type { Metadata } from "next";
import "react-international-phone/style.css";
import "react-toastify/dist/ReactToastify.css";
import PortalToasts from "@/components/PortalToasts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://swiftlineportal.com"),
  title: "Swiftline Cargo Portal",
  description: "A portal provided by Swiftline Cargo for managing your shipments and tracking your orders.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icon.png", type: "image/png", sizes: "192x192" }],
  },
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
