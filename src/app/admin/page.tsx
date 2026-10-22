/**
 * src/app/admin/page.tsx — Zulora AI Admin Dashboard (App Router Entrypoint)
 * =========================================================================
 * Restricts access exclusively to:
 *   - panwarshiven612@gmail.com
 *   - zulora.help@gmail.com
 *
 * Full management suites:
 * 1. User Management (view, verify, block/unblock, metrics)
 * 2. Content Control (categories, featured items, toggle availability)
 * 3. Payments & Transactions (revenue tracking, status filters, CSV export)
 * 4. Notifications (broadcast push alerts via FCM)
 * 5. Reports & Analytics (business metrics, conversion, exportable reports)
 */

import React from 'react';
import AdminPanel from '../../pages/admin/AdminPanel';

export default function AdminPage() {
  return <AdminPanel />;
}

export { AdminPanel };

