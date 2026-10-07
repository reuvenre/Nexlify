import { PublishedProducts, imageKey, sameProduct, titleTokens } from './product-similarity';

describe('imageKey', () => {
  it('drops the CDN size suffix and query', () => {
    expect(imageKey('https://ae01.alicdn.com/kf/S7a1b2c3d4e5f6.jpg_220x220.jpg'))
      .toBe(imageKey('https://ae-pic-a1.aliexpress-media.com/kf/S7a1b2c3d4e5f6.jpg?x=1'));
    expect(imageKey('https://ae01.alicdn.com/kf/S7a1b2c3d4e5f6.jpg')).toBe('s7a1b2c3d4e5f6');
  });

  it('ignores names too short to identify a photo', () => {
    expect(imageKey('https://x/1.jpg')).toBeNull();
    expect(imageKey('')).toBeNull();
  });
});

describe('sameProduct', () => {
  it('two stores selling one item: same photo, different id', () => {
    expect(sameProduct(
      { product_id: '1005001', title: 'Tactical Flashlight', image_url: 'https://ae01.alicdn.com/kf/Sabcdef123456789.jpg_350x350.jpg' },
      { product_id: '1005002', title: 'LED Torch Zoom', image_url: 'https://ae01.alicdn.com/kf/Sabcdef123456789.jpg' },
    )).toBe(true);
  });

  it('two stores selling one item: nearly the same title', () => {
    expect(sameProduct(
      { product_id: '1', title: 'Tactical Foregrip Picatinny Rail 20mm Vertical Grip Nylon Black' },
      { product_id: '2', title: 'Hot Sale Tactical Foregrip Picatinny Rail 20mm Vertical Grip Nylon Black' },
    )).toBe(true);
  });

  it('keeps different products apart', () => {
    expect(sameProduct(
      { product_id: '1', title: 'Tactical Foregrip Picatinny Rail 20mm Vertical Grip' },
      { product_id: '2', title: 'Tactical Flashlight 1000LM Picatinny Mount Pressure Switch' },
    )).toBe(false);
    expect(sameProduct({ product_id: '1', title: 'Knife' }, { product_id: '2', title: 'Knife' })).toBe(false);
  });

  it('reads Hebrew titles too', () => {
    expect(titleTokens('ידית אחיזה טקטית למסילת פיקטיני').size).toBe(5);
    expect(sameProduct(
      { product_id: '1', title: 'ידית אחיזה טקטית למסילת פיקטיני 20 מ"מ שחור' },
      { product_id: '2', title: 'ידית אחיזה טקטית למסילת פיקטיני 20 מ"מ שחור' },
    )).toBe(true);
  });
});

describe('PublishedProducts', () => {
  it('matches by id, photo and title, and says which listing it repeats', () => {
    const published = new PublishedProducts([
      { product_id: '111', title: 'Tactical Belt Quick Release Buckle Nylon Molle Outdoor', image_url: 'https://a/kf/Sbelt0000000001.jpg' },
    ]);
    expect(published.match({ product_id: '111', title: 'x' })).toBe('111');
    expect(published.match({ product_id: '222', title: 'y', image_url: 'https://b/kf/Sbelt0000000001.jpg_640x640.jpg' })).toBe('111');
    expect(published.match({ product_id: '333', title: 'Tactical Belt Quick Release Buckle Nylon Molle Outdoor 2026' })).toBe('111');
    expect(published.has({ product_id: '444', title: 'Night Vision Monocular Infrared Digital Hunting Camera' })).toBe(false);
  });

  it('grows as products are picked, so one run cannot pick the same item twice', () => {
    const run = new PublishedProducts();
    const a = { product_id: '1', title: 'Rifle Sling Two Point Adjustable Quick Detach Strap' };
    expect(run.has(a)).toBe(false);
    run.add(a);
    expect(run.has({ product_id: '2', title: 'Rifle Sling Two Point Adjustable Quick Detach Strap Black' })).toBe(true);
    expect(run.size).toBe(1);
  });
});
