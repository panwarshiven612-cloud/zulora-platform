/**
 * src/app/dashboard/page.tsx — Zulora AI Dashboard Entrypoint
 * ==========================================================
 * App Router wrapper for the unified Zulora AI workspace dashboard.
 */

import React from 'react';
import Dashboard from '../../pages/Dashboard';

export interface DashboardPageProps {
  initialTab?: string;
  guestMode?: boolean;
  onNavigate?: (path: string) => void;
}

export default function DashboardPage({
  initialTab = 'chat',
  guestMode = false,
  onNavigate = (path: string) => {
    if (typeof window !== 'undefined') window.location.href = path;
  }
}: DashboardPageProps) {
  return (
    <Dashboard 
      initialTab={initialTab} 
      guestMode={guestMode} 
      onNavigate={onNavigate} 
    />
  );
}

export { Dashboard };
