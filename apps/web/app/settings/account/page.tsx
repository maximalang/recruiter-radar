import { redirect } from "next/navigation";

export default function AccountSettingsPage(): never {
  redirect("/settings/security");
}
