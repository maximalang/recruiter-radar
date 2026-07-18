/* Recruiter Radar — web-push service worker.
 *
 * Minimal and single-purpose: show notifications for new strong leads and open
 * the relevant /leads context on click. No caching / offline behaviour — this
 * SW exists only to back the Push API.
 */

/**
 * Resolve a push-supplied URL to a SAME-ORIGIN absolute URL, defaulting to
 * /leads. The push payload comes from our own backend, but a service worker
 * must never navigate or open a window to an attacker-controlled origin if a
 * payload is ever forged or malformed — so we resolve against this origin and
 * reject anything that lands elsewhere. Returns an absolute href on this origin.
 */
function safeSameOriginUrl(raw) {
  const fallback = self.location.origin + "/leads";
  if (typeof raw !== "string" || raw.length === 0) {
    return fallback;
  }
  try {
    const resolved = new URL(raw, self.location.origin);
    return resolved.origin === self.location.origin ? resolved.href : fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Recruiter Radar";
  const options = {
    body: payload.body || "Появились новые лиды в радаре.",
    icon: "/icon.svg?v=brand-24",
    badge: "/icon.svg?v=brand-24",
    // Coalesce repeated pushes into one notification instead of stacking.
    tag: "recruiter-radar-leads",
    renotify: true,
    data: { url: safeSameOriginUrl(payload.url) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Re-validate at click time: the notification may have been created by an
  // older SW version before same-origin enforcement, so never trust data.url raw.
  const targetUrl = safeSameOriginUrl(
    event.notification.data && event.notification.data.url,
  );

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if one is already open.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              client.navigate(targetUrl).catch(() => {});
            }
            return undefined;
          }
        }
        // Otherwise open a new tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
