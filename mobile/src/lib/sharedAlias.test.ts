import { createApi } from '@rack/shared/client';
import { formatGBP } from '@rack/shared/format';

// Guards the @rack/shared wiring (tsconfig "paths", Metro watchFolders, Jest moduleNameMapper)
// and that the shared client runs under React Native's fetch with a bearer token.
describe('@rack/shared in the app', () => {
  it('resolves shared modules', () => {
    expect(formatGBP(12)).toContain('12');
  });

  it('uses a bearer token and no cookie', async () => {
    const fetch = jest.fn(async () => new Response('[]', { status: 200 }));
    const api = createApi({
      baseUrl: 'https://rack.example',
      fetch,
      credentials: 'omit',
      authHeaders: () => ({ Authorization: 'Bearer t' }),
    });
    await api.saved();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rack.example/api/saved');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t' });
  });
});
