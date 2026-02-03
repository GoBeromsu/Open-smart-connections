import test from 'ava';
import { register_status_bar_context_menu } from './register_status_bar_context_menu.js';

class StubItem {
  constructor() {
    this.title = '';
    this.icon = '';
    this.click = () => {};
  }
  setTitle(title) { this.title = title; return this; }
  setIcon(icon) { this.icon = icon; return this; }
  onClick(fn) { this.click = fn; return this; }
}

class StubMenu {
  constructor(app) { this.items = []; app.last_menu = this; }
  addItem(fn) { const item = new StubItem(); fn(item); this.items.push(item); }
  addSeparator() { this.items.push('sep'); }
  showAtPosition() {}
}

test('adds Export data menu item that triggers env.export_json', t => {
  let handler;
  const env = {
    main: {
      app: {},
      registerDomEvent: (_el, _ev, cb) => { handler = cb; },
    },
    export_json_called: false,
    export_json() { this.export_json_called = true; },
  };
  const status_container = {};
  register_status_bar_context_menu(env, status_container, { Menu: StubMenu });
  handler({ preventDefault() {}, stopPropagation() {}, pageX: 0, pageY: 0 });
  const export_item = env.main.app.last_menu.items.find(i => i.title === 'Export data');
  export_item.click();
  t.true(env.export_json_called);
});
