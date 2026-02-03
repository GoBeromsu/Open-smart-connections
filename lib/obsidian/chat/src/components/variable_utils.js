export function insert_variable_at_cursor(input_el, variable) {
  const doc = input_el.ownerDocument;
  const win = doc.defaultView;
  const sel = win.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (range && input_el.contains(range.startContainer)) {
    const node = doc.createTextNode(variable);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    input_el.appendChild(doc.createTextNode(variable));
  }
  input_el.dataset.hasContent = true;
  input_el.focus();
}

export function create_variable_menu(MenuClass, app, available_vars, on_select) {
  const menu = new MenuClass(app);
  for (const v of available_vars) {
    menu.addItem((item) =>
      item
        .setTitle(v)
        .onClick(() => on_select(v))
    );
  }
  return menu;
}
