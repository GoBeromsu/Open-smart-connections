import { smart_completions } from "smart-completions";
import { ThreadCompletionAdapter } from "../adapters/smart-completions/thread.js";
smart_completions.completion_adapters['ThreadCompletionAdapter'] = ThreadCompletionAdapter;

export default smart_completions;
