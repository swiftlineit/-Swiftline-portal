import { redirect } from "next/navigation";

// Notification links created before the delivery list became the canonical
// mobile workspace include an assignment id. Keep those links valid and send
// the delivery person to the list, where correction work is clearly badged.
export default function DriverDeliveryDeepLinkPage() {
  redirect("/driver/deliveries");
}
