export const normalizeGeMOrderNumber = (value: unknown): string => {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return normalized || "";
};

export const doesGeMOrderMatch = (candidate: unknown, expected: unknown): boolean => {
  const left = normalizeGeMOrderNumber(candidate);
  const right = normalizeGeMOrderNumber(expected);

  if (!left || !right) return false;
  if (left === right) return true;

  return left.includes(right) || right.includes(left);
};

export const extractGemBillNumber = (value: unknown): string => {
  const lastSegment = String(value ?? "").split("/").pop() ?? "";
  const match = lastSegment.match(/\d+/);
  return match ? String(parseInt(match[0], 10)) : "";
};

export const gemPdfKey = (billNumber: unknown, financialYear: unknown): string =>
  `${extractGemBillNumber(billNumber)}|${String(financialYear ?? "Unknown")}`;