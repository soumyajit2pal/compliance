import { createRoot } from 'react-dom/client';
import { App } from './app';
import '../styles.css';

const mount = document.getElementById('app');
if (!mount) throw new Error('The application mount element is missing.');

createRoot(mount).render(<App />);
