/** Entry for the static preview build: the real app, an in-memory router, and the mock API. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import '../index.css';
import { installMockApi } from './mockApi';

installMockApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="border-b border-line bg-navy px-4 py-2 text-center text-[13px] text-white">
      Interactive preview with development sample data. Changes are not saved, and Meta refresh, live ad previews and
      downloads work only in the installed app.
    </div>
    <MemoryRouter>
      <AppRoutes />
    </MemoryRouter>
  </StrictMode>,
);
