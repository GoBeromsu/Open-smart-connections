import { addIcon } from "obsidian";
export function add_smart_chat_icon() {
    addIcon("smart-chat", `<defs>
  <symbol id="smart-chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 4c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2h-8l-5 4v-4H4c-1.1 0-2-.9-2-2Z" stroke-width="2"></path>
    <path d="M7 8c.5.3 1.3.3 1.8 0" stroke-width="2"></path>
    <path d="M15.2 8c.5.3 1.3.3 1.8 0" stroke-width="2"></path>
    <path d="M8 11.5c1 .8 2.5 1.2 4 1.2s3-.4 4-1.2" stroke-width="2"></path>
  </symbol>
</defs>
<use href="#smart-chat-icon" />`);
}

export function add_smart_connections_icon() {
    addIcon("smart-connections", `<path d="M50,20 L80,40 L80,60 L50,100" stroke="currentColor" stroke-width="4" fill="none"/>
    <path d="M30,50 L55,70" stroke="currentColor" stroke-width="5" fill="none"/>
    <circle cx="50" cy="20" r="9" fill="currentColor"/>
    <circle cx="80" cy="40" r="9" fill="currentColor"/>
    <circle cx="80" cy="70" r="9" fill="currentColor"/>
    <circle cx="50" cy="100" r="9" fill="currentColor"/>
    <circle cx="30" cy="50" r="9" fill="currentColor"/>`);
}