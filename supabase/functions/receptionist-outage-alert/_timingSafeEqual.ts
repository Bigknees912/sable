// Constant-time string comparison for shared-secret webhook auth. A plain
// `!==` short-circuits on the first differing byte, which is a textbook
// timing side-channel for guessing a secret over many requests (see
// receptionist-server/lib's crypto.timingSafeEqual use for the same
// concern on the VAPI webhook secret - Deno's std crypto doesn't expose an
// equivalent, so this reimplements it: same length check up front (a
// non-fixed-time length branch reveals only length, not content), then an
// XOR-accumulate loop that always inspects every byte regardless of where
// a mismatch occurs.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}
