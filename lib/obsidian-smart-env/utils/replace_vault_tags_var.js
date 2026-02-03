export function replace_vault_tags_var(prompt) {
  const appRef = this.app;
  const tags = appRef?.metadataCache?.getTags?.() || {};
  const vault_tags = Object.keys(tags).map(tag => tag.replace('#', '')).join('\n  - ');
  return prompt.replace(/{{\s*(?:vault_tags|tags)\s*}}/gi, `\n  - ${vault_tags}\n`).trim();
}
