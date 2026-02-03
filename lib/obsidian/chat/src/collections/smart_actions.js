import { smart_actions, SmartActions } from 'smart-actions';
import * as lookup_context from '../actions/lookup_context.js';
smart_actions.default_actions = {
  lookup_context,
};
export { SmartActions };
export default smart_actions;