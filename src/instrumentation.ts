export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmVectors } = await import("@/lib/data.ts");
  void warmVectors().catch(() => {});
}
