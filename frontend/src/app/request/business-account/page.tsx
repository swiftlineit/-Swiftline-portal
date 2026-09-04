import type { Metadata } from "next";
import PublicBusinessAccountPage from "@/components/public-business-account/PublicBusinessAccountForm";
import { siteUrl } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Open a Swiftline Business Account | Online Application",
  description:
    "Apply online for a Swiftline Cargo business account to book international cargo and courier shipments. Complete KYC verification and get dedicated support.",
  alternates: { canonical: "/request/business-account" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Open a Swiftline Business Account | Online Application",
    description:
      "Apply online for a Swiftline Cargo business account for international cargo and courier shipping.",
    url: siteUrl("/request/business-account"),
    siteName: "Swiftline Cargo",
    type: "website"
  }
};

export default function RequestBusinessAccountRoute() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Open a Swiftline Business Account",
    description: metadata.description,
    url: siteUrl("/request/business-account"),
    about: {
      "@type": "Service",
      name: "Swiftline Cargo business account",
      serviceType: "Business shipping account",
      provider: {
        "@type": "Organization",
        name: "Swiftline Cargo",
        url: siteUrl("/")
      }
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PublicBusinessAccountPage />
    </>
  );
}
