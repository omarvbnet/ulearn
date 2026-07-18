/** Shared Apple receipt / JWS helpers for course + AI IAP verification. */

export function isLikelyAppleJws(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts[0].startsWith("eyJ");
}

export function assertAppleJwsMatches(
  jws: string,
  input: { productId: string; transactionId: string }
): boolean {
  try {
    const payloadB64 = jws.split(".")[1]!;
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const json = Buffer.from(normalized + pad, "base64").toString("utf8");
    const payload = JSON.parse(json) as {
      productId?: string;
      transactionId?: string;
      originalTransactionId?: string;
      bundleId?: string;
    };
    const productOk =
      !payload.productId || payload.productId === input.productId;
    const txOk =
      !payload.transactionId ||
      payload.transactionId === input.transactionId ||
      payload.originalTransactionId === input.transactionId;
    const bundleOk =
      !payload.bundleId || payload.bundleId === "com.ulearn.mobile";
    return productOk && txOk && bundleOk;
  } catch {
    return false;
  }
}
