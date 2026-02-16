export function determine_installed_at(
  current: number | null,
  data_file_ctime: number | null,
): number | null {
  if (typeof data_file_ctime !== 'number') return current ?? null;
  if (typeof current !== 'number' || data_file_ctime < current) return data_file_ctime;
  return current;
}
