import { createClient } from "npm:@supabase/supabase-js@2";

const secret = Deno.env.get("SMS_HMAC_SECRET")!;
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function hmacHex(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const body = await req.text();                       // corps BRUT : la signature porte dessus
  const expected = await hmacHex(body);
  if (!safeEqual(req.headers.get("x-signature") ?? "", expected)) {
    return new Response("unauthorized", { status: 401 }); // 4xx => le moteur retente quand meme (voir README)
  }

  let sms: { from: string; text: string; sentStamp?: number; sim?: string };
  try { sms = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }

  const { error } = await db.from("sms_inbox").insert({
    sender: sms.from,
    body: sms.text,
    sim: sms.sim ?? null,
    sent_at: sms.sentStamp ? new Date(sms.sentStamp).toISOString() : null,
  });

  // 2xx = acquitte. 5xx = le moteur retente (backoff exponentiel).
  return new Response(error ? "db error" : "ok", { status: error ? 500 : 200 });
});
