import {
  findMatchingClientProfileForCheckoutOrder,
  saveClientProfile,
} from "@/lib/clientProfiles";

describe("paid client profile tenancy", () => {
  it("rejects a create without explicit owner and workspace", async () => {
    const query = jest.fn();

    await expect(saveClientProfile({ agencyName: "Новая практика" }, { query }))
      .rejects.toThrow("ownerId and workspaceId are required");

    expect(query).not.toHaveBeenCalled();
  });

  it("matches paid-order profiles only in the persisted owner/workspace scope", async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    await findMatchingClientProfileForCheckoutOrder({
      checkoutOrderId: "44",
      ownerId: "101",
      workspaceId: "202",
      agencyName: "Новая практика",
    }, { query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["Новая практика", 101, 202]);
    expect(query.mock.calls[0][0]).toContain("owner_id = $2 AND workspace_id = $3");
  });
});
