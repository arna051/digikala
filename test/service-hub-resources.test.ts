import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import {
  DigikalaAxiosTransport,
  DigikalaOrdersResource,
  DigikalaProductEditingResource,
  DigikalaProfileResource,
  DigikalaServiceHubResource,
  DigikalaShipmentsResource,
} from '../src/node/index.js';

function setup(data: unknown = { status: 'ok', data: {} }) {
  const requests: AxiosRequestConfig[] = [];
  const adapter = vi.fn<AxiosAdapter>((config) => {
    requests.push(config);
    const response: AxiosResponse = {
      data,
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
    return Promise.resolve(response);
  });
  const transport = new DigikalaAxiosTransport({
    adapter,
    credentials: () => ({ accessToken: 'token', sellerCode: '123' }),
    rateLimit: false,
  });
  return { transport, requests };
}

describe('Service Hub resources', () => {
  it('maps profile reads and business updates', async () => {
    const read = setup({ status: 'ok', data: { seller_id: 1 } });
    await new DigikalaProfileResource(read.transport).get({ mini: true });
    expect(read.requests[0]?.url).toBe('profile');
    expect(read.requests[0]?.params).toEqual({ mini: 'true' });

    const update = setup();
    await new DigikalaProfileResource(update.transport).updateBusiness({
      companyName: 'Store',
    });
    expect(update.requests[0]?.method).toBe('patch');
    expect(update.requests[0]?.url).toBe('profile/business');
    expect(JSON.parse(String(update.requests[0]?.data))).toEqual({
      company_name: 'Store',
    });
  });

  it('maps DK shipment list, package and creation contracts', async () => {
    const list = setup({ status: 'ok', data: { items: [] } });
    const resource = new DigikalaShipmentsResource(list.transport);
    await resource.list({ search: { shipmentStatus: 'new' } });
    expect(list.requests[0]?.params).toEqual({
      'search[shipment_status]': 'new',
    });

    const packages = setup({ status: 'ok', data: { items: [] } });
    await new DigikalaShipmentsResource(packages.transport).packages({
      packageIds: [1, 2],
      warehouseId: 3,
    });
    expect(packages.requests[0]?.url).toBe('shipments/dk/packages');
    expect(packages.requests[0]?.params).toMatchObject({
      package_ids: '1,2',
      'search[warehouse_id]': 3,
    });

    const create = setup();
    await new DigikalaShipmentsResource(create.transport).create({
      packageIds: [1],
      warehouseId: 2,
      pickupDate: '2026-11-05T10:00:00Z',
      timeScope: '10-12',
    });
    expect(create.requests[0]?.method).toBe('post');
    expect(JSON.parse(String(create.requests[0]?.data))).toEqual({
      package_ids: [1],
      warehouse_id: 2,
      pickup_date: '2026-11-05T10:00:00Z',
      time_scope: '10-12',
    });
  });

  it('maps order history and statistics', async () => {
    const history = setup({ status: 'ok', data: { items: [] } });
    const orders = new DigikalaOrdersResource(history.transport);
    await orders.history({ orderType: 'returned', shippingType: 'digikala' });
    expect(history.requests[0]?.url).toBe('orders/history');
    expect(history.requests[0]?.params).toMatchObject({
      order_type: 'returned',
      shipping_type: 'digikala',
    });

    const statistics = setup({ status: 'ok', data: {} });
    await new DigikalaOrdersResource(statistics.transport).statistics();
    expect(statistics.requests[0]?.url).toBe('orders/statistics');
  });

  it('maps product editing and title suggestion bodies', async () => {
    const update = setup();
    const editing = new DigikalaProductEditingResource(update.transport);
    await editing.update({
      productId: 10,
      categoryId: 20,
      brandId: 30,
      isIranian: false,
      generalMefaId: '123',
    });
    expect(update.requests[0]?.url).toBe('product-edit/10');
    expect(JSON.parse(String(update.requests[0]?.data))).toMatchObject({
      category_id: 20,
      brand_id: 30,
      is_iranian: false,
      general_mefa_id: '123',
    });
  });

  it('provides a safe generic bridge for the remaining official operations', async () => {
    const setupResult = setup({ status: 'ok', data: { balance: 1 } });
    const serviceHub = new DigikalaServiceHubResource(setupResult.transport);
    await serviceHub.request({
      method: 'GET',
      path: 'shipping-services/wallet/balance',
      query: { details: true },
    });
    expect(setupResult.requests[0]?.url).toBe(
      'shipping-services/wallet/balance',
    );
    expect(setupResult.requests[0]?.params).toEqual({ details: true });

    await expect(
      serviceHub.request({ method: 'GET', path: 'https://evil.test' }),
    ).rejects.toThrow();
    expect(setupResult.requests).toHaveLength(1);
  });
});
