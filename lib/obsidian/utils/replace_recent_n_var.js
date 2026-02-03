export function replace_recent_n_var(prompt) {
  console.log('replace_recent_n_var', prompt);
  const env = this;
  return prompt.replace(/{{\s*recent_(\d+)\s*}}/gi, (_, count) => {
    const n = parseInt(count, 10) || 0;
    const files = Object.values(env.smart_sources?.fs?.files ?? {})
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, n)
      .map(f => f.path)
      .join('\n  - ')
    ;
    console.log('replace_recent_n_var', n, files);
    return files ? `\n  - ${files}` : '';
  }).trim();
}
