export function buildKernelModel(
  adapter: string,
  modelKey: string,
  host: string,
  dims: number | null,
): {
  adapter: string;
  modelKey: string;
  host: string;
  dims: number | null;
  fingerprint: string;
} {
  const normalizedAdapter = (adapter || '').trim().toLowerCase();
  const normalizedModel = (modelKey || '').trim().toLowerCase();
  const normalizedHost = (host || '').trim().toLowerCase();
  return {
    adapter: normalizedAdapter,
    modelKey: normalizedModel,
    host: normalizedHost,
    dims,
    fingerprint: `${normalizedAdapter}|${normalizedModel}|${normalizedHost}`,
  };
}
