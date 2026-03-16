const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    ...extraHeaders,
  },
  body: JSON.stringify(body),
});

const ok = (body) => json(200, body);
const badRequest = (message, details) => json(400, { error: message, details });
const unauthorized = (message = 'Unauthorized') => json(401, { error: message });
const methodNotAllowed = (allowed = ['POST']) => json(405, { error: 'Method not allowed' }, { allow: allowed.join(', ') });
const serverError = (message = 'Internal server error', details) => json(500, { error: message, details });

const readJsonBody = async (event) => {
  if (!event.body) return {};
  return JSON.parse(event.body);
};

export { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError, unauthorized };