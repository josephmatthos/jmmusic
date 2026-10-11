'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function CheckoutFailurePage() {
  const [hasPendingOrder, setHasPendingOrder] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasPendingOrder(!!sessionStorage.getItem('jm_last_order_id'));
  }, []);

  async function retry() {
    const orderId = sessionStorage.getItem('jm_last_order_id');
    if (!orderId) return;

    setRetrying(true);
    setError(null);
    try {
      const checkout = await api.createRentalCheckout(orderId);
      if (!checkout.checkoutUrl) {
        setError('Não foi possível reiniciar o pagamento.');
        setRetrying(false);
        return;
      }
      window.location.href = checkout.checkoutUrl;
    } catch (e) {
      setError((e as Error).message);
      setRetrying(false);
    }
  }

  return (
    <section className="py-20">
      <div className="max-w-lg mx-auto px-6 text-center">
        <div className="text-5xl mb-4">😔</div>
        <h1 className="text-3xl font-black mb-3">Pagamento não concluído</h1>
        <p className="text-muted mb-8">
          Não conseguimos confirmar seu pagamento. Nenhuma cobrança foi feita.
        </p>

        {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {hasPendingOrder ? (
            <button
              onClick={retry}
              disabled={retrying}
              className="px-6 py-3 rounded-full font-bold bg-gold text-[#16130c] hover:bg-gold2 transition disabled:opacity-50"
            >
              {retrying ? 'Redirecionando…' : 'Tentar novamente'}
            </button>
          ) : (
            <Link
              href="/plans"
              className="px-6 py-3 rounded-full font-bold bg-gold text-[#16130c] hover:bg-gold2 transition"
            >
              Ver planos
            </Link>
          )}
          <Link
            href="/catalog"
            className="px-6 py-3 rounded-full border border-line hover:border-gold transition"
          >
            Voltar ao catálogo
          </Link>
        </div>
      </div>
    </section>
  );
}