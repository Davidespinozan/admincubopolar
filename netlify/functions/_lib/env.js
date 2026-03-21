const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Variable de entorno faltante en Netlify: ${name}`);
  return value;
};

const optionalEnv = (name, fallback = '') => process.env[name] || fallback;

export { optionalEnv, requireEnv };