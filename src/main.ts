import './app.css';
import App from './App.svelte';
import { mount } from 'svelte';

window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error || event.message);
  const target = document.getElementById('app');
  if (target && !target.hasChildNodes()) {
    target.innerHTML = `
      <div style="padding: 24px; font-family: monospace; color: #ff5555; background: #181818; height: 100vh;">
        <h2 style="font-size: 16px; margin-bottom: 8px;">Application Error</h2>
        <pre style="font-size: 12px; white-space: pre-wrap; color: #ff9999;">${event.message}\n${event.error?.stack || ''}</pre>
      </div>
    `;
  }
});

const target = document.getElementById('app');
let app: any = null;

if (target) {
  try {
    app = mount(App, { target });
  } catch (err: any) {
    console.error('Failed to mount App:', err);
    target.innerHTML = `
      <div style="padding: 24px; font-family: monospace; color: #ff5555; background: #181818; height: 100vh;">
        <h2 style="font-size: 16px; margin-bottom: 8px;">Mount Error</h2>
        <pre style="font-size: 12px; white-space: pre-wrap; color: #ff9999;">${err?.message || err}\n${err?.stack || ''}</pre>
      </div>
    `;
  }
}

export default app;
