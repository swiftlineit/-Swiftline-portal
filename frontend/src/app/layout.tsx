import type { Metadata } from "next";
import "react-international-phone/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swiftline Cargo Portal",
  description: "A portal provided by Swiftline Cargo for managing your shipments and tracking your orders.",
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
