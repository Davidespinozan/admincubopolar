const FUNCTIONS_BASE = '/.netlify/functions';

async function parseJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${FUNCTIONS_BASE}/${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await parseJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed: ${response.status}`);
    error.details = data?.details;
    error.status = response.status;
    throw error;
  }

  return data;
}

const backendGet = (path) => request(path, { method: 'GET' });
const backendPost = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export { backendGet, backendPost };