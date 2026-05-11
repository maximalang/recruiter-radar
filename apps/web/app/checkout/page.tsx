import Link from "next/link";
import { redirect } from "next/navigation";

import { startCheckoutOrder } from "../../lib/payments";
import { buildCheckoutHref, readPublicPreviewInput } from "../../lib/publicProduct";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const restartHref = buildCheckoutHref(input);

  try {
    const result = await startCheckoutOrder({
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
  } catch {
    return (
      <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "Inter, sans-serif" }}>
        <h1>Checkout</h1>
        <p>Не удалось запустить оплату. Попробуйте снова после обновления параметров.</p>
        <p><Link href={restartHref}>Обновить параметры пилота</Link></p>
      </main>
    );
  }
}
