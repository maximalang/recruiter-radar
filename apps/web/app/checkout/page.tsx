import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { startCheckoutOrder } from "../../lib/payments";
import { buildCheckoutHref, readPublicPreviewInput } from "../../lib/publicProduct";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const restartHref = buildCheckoutHref(input);
  const ownerId = (await cookies()).get("rr_user_id")?.value?.trim() ?? null;

  async function startCheckoutAction() {
    "use server";

    if (!ownerId) {
      redirect(`${restartHref}${restartHref.includes("?") ? "&" : "?"}checkoutError=missing-owner`);
    }

    const result = await startCheckoutOrder({
      userId: ownerId,
      productCode: "pilot",
      customerName: "Self-serve pilot checkout",
      customerContact: "checkout@recruiter-radar.local",
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000"
    });

    redirect(result.redirectUrl);
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "Inter, sans-serif" }}>
      <h1>Checkout</h1>
      <p>Оплата запускается только после явного подтверждения.</p>
      {!ownerId ? <p>Войдите в аккаунт, чтобы запустить пилот на свой профиль.</p> : null}
      <form action={startCheckoutAction}>
        <button type="submit" disabled={!ownerId}>Перейти к оплате</button>
      </form>
      <p><Link href={restartHref}>Обновить параметры пилота</Link></p>
    </main>
  );
}
