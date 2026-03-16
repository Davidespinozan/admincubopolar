const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const optionalEnv = (name, fallback = '') => process.env[name] || fallback;

export { optionalEnv, requireEnv };