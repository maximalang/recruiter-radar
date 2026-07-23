/** @jest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";

import LandingCheckoutAnalytics from "@/app/landing-checkout-analytics";
import PaymentSuccessAnalytics from "@/app/payment-success-analytics";

describe("landing funnel analytics", () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 204 });

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
    sessionStorage.clear();
  });

  it("tracks checkout view and starts payment only for the self-serve plan", () => {
    const { unmount } = render(
      <>
        <form data-checkout-form />
        <LandingCheckoutAnalytics trackPaymentStart />
      </>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.submit(document.querySelector("[data-checkout-form]")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"name":"payment_started"');
    unmount();

    fetchMock.mockClear();
    render(
      <>
        <form data-checkout-form />
        <LandingCheckoutAnalytics trackPaymentStart={false} />
      </>,
    );
    fireEvent.submit(document.querySelector("[data-checkout-form]")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"name":"checkout_viewed"');
  });

  it("deduplicates payment success in sessionStorage without sending the order id", () => {
    const { unmount } = render(<PaymentSuccessAnalytics dedupeKey="order-42" />);
    unmount();
    render(<PaymentSuccessAnalytics dedupeKey="order-42" />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"name":"payment_succeeded"');
    expect(fetchMock.mock.calls[0][1]?.body).not.toContain("order-42");
  });
});
