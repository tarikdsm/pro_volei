const UINT32_MAX = 0xffff_ffff;

/** Parser estrito para o parâmetro público `seed`: decimal uint32 ou `null`. */
export function parseSeed(input: string | null | undefined): number | null {
  if (input === null || input === undefined || !/^\d+$/.test(input)) return null;
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > UINT32_MAX) return null;
  return parsed;
}
