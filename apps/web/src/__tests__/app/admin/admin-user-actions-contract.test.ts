import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "app/admin/users/[id]/admin-user-actions.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(process.cwd(), "app/admin/users/[id]/admin-user-actions.module.css"),
  "utf8",
);

describe("Admin UCC action surface", () => {
  it("keeps controls at least 44px and separates destructive actions", () => {
    expect(source).not.toMatch(/minHeight:\s*40/);
    expect(source).toMatch(/minHeight:\s*44/g);
    expect(source).toContain("styles.dangerZone");
    expect(source).toContain("styles.groupTitle");
    expect(styles).toContain("@media (max-width: 640px)");
  });
});
