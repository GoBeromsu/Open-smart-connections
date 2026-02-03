import { getIcon } from "obsidian";
export function build_html(plugin, opts={}) {
  const {plugin_name = plugin.manifest.name} = opts;
  return `<div class="wrapper">
    <div id="footer-callout" data-callout-metadata="" data-callout-fold="" data-callout="info" class="callout" style="mix-blend-mode: unset;">
      <div class="callout-title" style="align-items: center;">
        <div class="callout-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-info">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
          </svg>
        </div>
        <div class="callout-title-inner"><strong>User Agreement</strong></div>
      </div>
      <div class="callout-content">
        <p>By using ${plugin_name} you agree to share how it helps you with at least one other person 😊🌴</p>
      </div>
    </div>
  </div>`;
}

export function render(plugin, opts={}) {
  const html = build_html.call(this, plugin, opts);
  const frag = this.create_doc_fragment(html);
  const callout = frag.querySelector('#footer-callout');
  const icon_container = callout.querySelector('.callout-icon');
  const icon = getIcon('smart-connections');
  if (icon) {
    this.empty(icon_container);
    icon_container.appendChild(icon);
  }
  post_process.call(this, plugin, callout, opts);
  return callout;
}

function post_process(plugin, callout) {
}