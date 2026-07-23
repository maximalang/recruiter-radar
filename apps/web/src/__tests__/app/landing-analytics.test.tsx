/** @jest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";

import LandingAnalytics from "@/app/landing-analytics";
import LandingCheckoutAnalytics from "@/app/landing-checkout-analytics";

describe("landing funnel analytics", () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 204 });

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
    sessionStorage.clear();
  });

  it("tracks checkout view and uses submit semantics for payment and continuation", () => {
    const { unmount } = render(
      <>
        <form data-checkout-form />
        <LandingCheckoutAnalytics submitEvent="payment_started" />
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
        <LandingCheckoutAnalytics submitEvent="continuation_requested" />
      </>,
    );
    fireEvent.submit(document.querySelector("[data-checkout-form]")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"name":"checkout_viewed"');
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"name":"continuation_requested"');
    expect(fetchMock.mock.calls[1][1]?.body).not.toContain('"name":"payment_started"');
  });

  it("tracks FAQ only on each closed-to-open transition without click duplication", () => {
    render(
      <>
        <details data-analytics-event="faq_opened">
          <summary>Как это работает?</summary>
          <p>Ответ</p>
        </details>
        <LandingAnalytics />
      </>,
    );
    const details = document.querySelector("details")!;
    const summary = document.querySelector("summary")!;
    fetchMock.mockClear();

    fireEvent.click(summary);
    expect(fetchMock).not.toHaveBeenCalled();

    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    details.open = false;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
