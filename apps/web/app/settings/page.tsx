import { redirect } from "next/navigation";

/**
 * /settings redirects to the client-profile editor at /profile. Kept so a user
 * who types /settings or follows an old "settings" cue lands on the real page
 * instead of a 404. When more settings surfaces exist, this becomes an index.
 */
export default function SettingsIndexPage(): never {
  redirect("/profile");
}
