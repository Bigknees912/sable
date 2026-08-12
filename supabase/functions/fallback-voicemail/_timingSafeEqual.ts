// Constant-time string comparison for shared-secret webhook auth. See
// receptionist-server/lib's crypto.timingSafeEqual for the same concern on
// the Vapi webhook secret - Deno's std crypto doesn't expose an equivalent,
// so this reimplements it: length check up front, then an XOR-accumulate
// loop that always inspects every byte regardless of where a mismatch occurs.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}
