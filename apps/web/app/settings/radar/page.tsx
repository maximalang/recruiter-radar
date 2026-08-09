export { default, metadata } from "../../profile/page";

// Route-segment config must be statically declared in this module; Next.js 16
// does not accept re-exported `dynamic` fields.
export const dynamic = "force-dynamic";
