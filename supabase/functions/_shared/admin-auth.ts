function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isInventoryAdmin(passcode: unknown): boolean {
  const expected = Deno.env.get("INVENTORY_ADMIN_PASSCODE") || "";
  const supplied = String(passcode ?? "");
  return expected.length >= 12 && constantTimeEqual(supplied, expected);
}
