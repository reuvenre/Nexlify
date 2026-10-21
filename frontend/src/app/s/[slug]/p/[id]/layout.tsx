import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PIN_VISIT_HEADER } from '@/lib/pin-visit';

/**
 * What a crawler reads for one product page — Pinterest above all.
 *
 * The page itself is a client component, so before this the server HTML of every product
 * carried the root layout's metadata: the Nexlify SaaS title and description, in Hebrew,
 * with no product image or price. Pinterest reads a pin's destination to decide what the
 * pin is and whether to show it, and every one of our pins pointed at a page that said it
 * was about a marketing tool. Here the product's own name, photo and price are rendered on
 * the server: Open Graph (with product:price for rich pins) and schema.org Product.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

interface ProductForMeta {
  title: string;
  brand?: string | null;
  image?: string | null;
  gallery?: string[];
  price: number;
  currency: string;
  /** Set when a pin should never have led here (the owner's link switch is off, or the post is not for the Hebrew store). */
  pin_redirect?: string;
}

async function readProduct(slug: string, id: string): Promise<ProductForMeta | null> {
  try {
    const res = await fetch(
      `${API}/store/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    return (await res.json()) as ProductForMeta;
  } catch {
    return null;
  }
}

async function readStoreName(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/store/${encodeURIComponent(slug)}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const meta = (await res.json()) as { name?: string };
    return meta?.name || null;
  } catch {
    return null;
  }
}

/** An absolute image URL a crawler can fetch. Yupoo blocks hotlinking, so it goes through our proxy. */
function crawlableImage(src: string | null | undefined): string | null {
  const url = String(src || '').trim();
  if (!/^https?:\/\//.test(url)) return null;
  if (/yupoo\.com/i.test(url)) return `${API}/suppliers/image?url=${encodeURIComponent(url)}`;
  return url;
}

function priceText(p: ProductForMeta): string {
  const symbol = p.currency === 'USD' ? '$' : p.currency === 'ILS' ? '₪' : p.currency === 'EUR' ? '€' : '';
  return symbol ? `${symbol}${p.price.toFixed(2)}` : `${p.price.toFixed(2)} ${p.currency}`;
}

function describe(p: ProductForMeta, store: string | null): string {
  const price = priceText(p);
  const parts = [p.title, p.brand ? `(${p.brand})` : '', `— ${price}`, store ? `| ${store}` : ''];
  return parts.filter(Boolean).join(' ').slice(0, 300);
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Metadata> {
  const { slug, id } = await params;
  const [product, store] = await Promise.all([readProduct(slug, decodeURIComponent(id)), readStoreName(slug)]);
  if (!product) return { title: store || 'מוצר', robots: { index: false } };
  const image = crawlableImage(product.image || product.gallery?.[0]);
  const description = describe(product, store);
  // absolute: a customer's store page is the customer's, not "· Nexlify".
  const title = store ? `${product.title} | ${store}` : product.title;
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title: product.title,
      description,
      siteName: store || undefined,
      images: image ? [{ url: image, alt: product.title }] : undefined,
    },
    twitter: { card: 'summary_large_image', title: product.title, description, images: image ? [image] : undefined },
  };
}

export default async function ProductLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const product = await readProduct(slug, decodeURIComponent(id));
  // A pin that should not have led to the store (switch off, or an English campaign's pin
  // landing on the Hebrew store) goes on to the product, through the tracked link. This is
  // what fixes the pins already published; new ones no longer point here.
  if (product?.pin_redirect && (await headers()).get(PIN_VISIT_HEADER) === '1') {
    redirect(product.pin_redirect);
  }
  const image = product ? crawlableImage(product.image || product.gallery?.[0]) : null;
  // schema.org Product: the other format Pinterest (and Google) read for a product page.
  const jsonLd = product ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(image ? { image: [image] } : {}),
    offers: {
      '@type': 'Offer',
      price: product.price.toFixed(2),
      priceCurrency: product.currency,
      availability: 'https://schema.org/InStock',
    },
  } : null;
  // og:type "product" and the price, as property= tags (Next's metadata API writes custom
  // tags as name= and has no 'product' type). React hoists these into <head>.
  const amount = product ? product.price.toFixed(2) : '';
  return (
    <>
      {product && (
        <>
          <meta property="og:type" content="product" />
          <meta property="product:price:amount" content={amount} />
          <meta property="product:price:currency" content={product.currency} />
          <meta property="og:price:amount" content={amount} />
          <meta property="og:price:currency" content={product.currency} />
        </>
      )}
      {jsonLd && (
        <script
          type="application/ld+json"
          // The values are the store's own product fields, serialized — and "<" escaped so
          // a title can never close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      {children}
    </>
  );
}
