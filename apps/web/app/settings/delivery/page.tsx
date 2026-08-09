import { redirect } from "next/navigation";

export default function DeliverySettingsPage(): never {
  redirect("/settings/radar#delivery");
}
