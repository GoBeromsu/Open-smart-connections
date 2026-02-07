import {
  ConnectionsView as NextConnectionsView,
  CONNECTIONS_VIEW_TYPE,
} from './ConnectionsView';

export { CONNECTIONS_VIEW_TYPE };

export class ConnectionsView extends NextConnectionsView {
  static get_view(workspace: any): ConnectionsView | null {
    return NextConnectionsView.getView(workspace) as ConnectionsView | null;
  }
}
