import type { CreditAccountStatus } from "@/lib/creditAccounts";

type Tone = {
  bg: string;
  text: string;
  border: string;
  dot: string;
};

// Palette: #0D1282 (indigo), #EEEDED (neutral), #F0DE36 (yellow), #D71313 (red)
// Filled = definitive/live states, outlined = transitional/in-review, muted = terminal/inactive.
const tones: Record<CreditAccountStatus, Tone> = {
  NOT_REQUESTED: { bg: "#EEEDED", text: "#6B6D70", border: "#DAD9D9", dot: "#9A9C9F" },
  PENDING_REVIEW: { bg: "#FDF8DC", text: "#7A6A00", border: "#EFE1A0", dot: "#F0DE36" },
  APPROVED: { bg: "#E8E9F6", text: "#0D1282", border: "#C4C6EC", dot: "#0D1282" },
  ACTIVE: { bg: "#0D1282", text: "#FFFFFF", border: "#0D1282", dot: "#F0DE36" },
  ON_HOLD: { bg: "#F0DE36", text: "#5A4E00", border: "#DCC800", dot: "#5A4E00" },
  SUSPENDED: { bg: "#FBEAEA", text: "#D71313", border: "#F1BEBE", dot: "#D71313" },
  EXPIRED: { bg: "#E4E3E3", text: "#63656A", border: "#D0CFCF", dot: "#8B8D90" },
  REJECTED: { bg: "#D71313", text: "#FFFFFF", border: "#D71313", dot: "#FFFFFF" },
  CLOSED: { bg: "#DEDDDD", text: "#54565A", border: "#C9C8C8", dot: "#54565A" }
};

export default function CreditStatusBadge({ status }: { status: CreditAccountStatus }) {
  const tone = tones[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: tone.bg, color: tone.text, borderColor: tone.border }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
      {status.replaceAll("_", " ")}
    </span>
  );
}