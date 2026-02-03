/**
 * Retrieve selected text from an editor object.
 *
 * @param {object} editor - Editor with getSelection method.
 * @returns {string} Selected text or empty string.
 */

export function get_editor_selection(editor) {
  if (editor && typeof editor.getSelection === 'function') {
    return editor.getSelection();
  }
  return '';
}
