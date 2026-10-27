import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ensureGoldApiBridge } from './utils/goldApiBridge';

ensureGoldApiBridge();

createRoot(document.getElementById('root')!).render(<App />);
