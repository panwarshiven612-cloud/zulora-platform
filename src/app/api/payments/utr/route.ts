export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { utr, mobileNumber, plan = 'Pro', amount = 299, email, userId } = body;

    const trimmedUtr = String(utr || '').trim();
    if (!/^\d{12}$/.test(trimmedUtr)) {
      return new Response(
        JSON.stringify({ error: 'Invalid 12-digit UTR or Transaction ID.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Save transaction to Firestore via REST API
    const projectId = 'zulora-al';
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/transactions`;

    const docFields: Record<string, any> = {
      utr: { stringValue: trimmedUtr },
      plan: { stringValue: String(plan) },
      amount: { integerValue: String(amount) },
      status: { stringValue: 'pending' },
      createdAt: { integerValue: String(Date.now()) },
      source: { stringValue: 'UPI' }
    };

    if (email) docFields.email = { stringValue: String(email) };
    if (userId) docFields.userId = { stringValue: String(userId) };
    if (mobileNumber) docFields.mobileNumber = { stringValue: String(mobileNumber) };

    const firestoreRes = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: docFields })
    });

    if (!firestoreRes.ok) {
      console.warn('[Payments UTR] Firestore REST API save warning:', await firestoreRes.text().catch(() => ''));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'UTR recorded successfully. Our team will verify and activate your Pro plan shortly.',
        utr: trimmedUtr
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Payments UTR API Error]:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
