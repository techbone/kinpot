export const revalidate = 21600; // six hours

/** USD → NGN reference rate for showing naira estimates. Display only: nothing settles at this rate. */
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate } });
    const json = (await res.json()) as { result?: string; rates?: { NGN?: number }; time_last_update_unix?: number };
    if (json.result !== "success" || !json.rates?.NGN) throw new Error("bad response");
    return Response.json({ ngn: json.rates.NGN, asOf: json.time_last_update_unix ?? null });
  } catch {
    return Response.json({ ngn: null, asOf: null });
  }
}
