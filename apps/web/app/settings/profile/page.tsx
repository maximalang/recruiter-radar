import { redirect } from "next/navigation";

/**
 * Backward-compat redirect: the client-profile editor used to live at
 * /settings/profile and moved to the cleaner /profile URL. Old bookmarks,
 * Telegram-bot links, and saved tabs that point at the legacy path still land
 * on the real page instead of a 404. Safe to delete once no external links
 * remain (there is no analytics signal here — it is a plain 308 to /profile).
 */
export default function LegacySettingsProfilePage(): never {
  redirect("/profile");
}
