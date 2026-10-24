import { createRoot } from 'react-dom/client';
import { SessionTreeApp } from './SessionTree';
import '../../plugins/session-tree/src/ui/codex/panel.css';
import './react-layout.css';

createRoot(document.getElementById('root')!).render(<SessionTreeApp/>);
