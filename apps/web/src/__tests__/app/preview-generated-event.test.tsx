/** @jest-environment jsdom */

import { render, waitFor } from "@testing-library/react";

import PreviewGeneratedEvent from "@/app/preview-generated-event";

describe("PreviewGeneratedEvent", () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 204 });

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
    window.history.replaceState({}, "", "/?specialization=engineering#preview-results");
    sessionStorage.clear();
  });

  it("does not emit preview_generated for a fallback or non-personalized preview", () => {
    render(<PreviewGeneratedEvent generated={false} context="preview" />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("emits once for the same personalized query without sending query values", async () => {
    const { unmount } = render(
      <PreviewGeneratedEvent generated context="preview" />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();
    render(<PreviewGeneratedEvent generated context="preview" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('"name":"preview_generated"');
    expect(body).toContain('"context":"preview"');
    expect(body).not.toContain("engineering");
  });
});
