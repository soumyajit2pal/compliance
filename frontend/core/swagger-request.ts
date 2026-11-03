/** Swagger uses the same cookie/CSRF contract as the portal; API authority is unchanged. */
export function createSwaggerRequestGuard(origin: string, requestFetch: typeof fetch, expired = () => {}) {
  const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return async (request: any) => {
    const url = new URL(request.url, origin);
    if (url.origin !== origin || (url.pathname !== '/openapi.json' && !url.pathname.startsWith('/api/'))) {
      throw new Error('Swagger can call only this portal’s API.');
    }
    request.credentials = 'same-origin';
    const method = String(request.method || 'GET').toUpperCase();
    if (!readMethods.has(method) && url.pathname !== '/api/auth/login') {
      const response = await requestFetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) expired();
        throw new Error('Sign in using the form above, then retry this request.');
      }
      const identity = await response.json();
      if (typeof identity.csrf_token !== 'string' || !identity.csrf_token) {
        expired();
        throw new Error('Your session is unavailable. Sign in again above.');
      }
      request.headers = request.headers || {};
      request.headers['X-CSRF-Token'] = identity.csrf_token;
    }
    return request;
  };
}

export function swaggerOptions(requestInterceptor: any, responseInterceptor?: any) {
  return {
    url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, docExpansion: 'list',
    displayRequestDuration: true, defaultModelsExpandDepth: -1, filter: true,
    validatorUrl: null, queryConfigEnabled: false, persistAuthorization: false,
    withCredentials: true, showMutatedRequest: false,
    supportedSubmitMethods: ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'],
    requestInterceptor, responseInterceptor,
  };
}
