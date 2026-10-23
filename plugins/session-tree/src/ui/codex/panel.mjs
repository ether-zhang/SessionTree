import { mountTreePanel } from '../shared/panel.mjs';
import { AppBridge } from './transport.mjs';

mountTreePanel(window, new AppBridge(window, { displayModes: ['fullscreen'] }), { assistantLabel: 'Codex' });
