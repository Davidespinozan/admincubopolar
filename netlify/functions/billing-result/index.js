export const handler = async (event) => {
  const params = event.queryStringParameters || {};
  const status = params.status; // 'success' or 'cancel'
  const folio = params.folio || '';

  const isSuccess = status === 'success';
  const title = isSuccess ? 'Pago exitoso' : 'Pago cancelado';
  const emoji = isSuccess ? '✅' : '❌';
  const message = isSuccess
    ? `Tu pago${folio ? ` de la orden ${folio}` : ''} ha sido recibido correctamente.`
    : `El pago${folio ? ` de la orden ${folio}` : ''} fue cancelado. Puedes intentar de nuevo con el mismo enlace.`;
  const color = isSuccess ? '#059669' : '#dc2626';
  const bg = isSuccess ? '#ecfdf5' : '#fef2f2';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Cubo Polar</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${bg};
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 20px;
      padding: 48px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .emoji { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: ${color}; margin-bottom: 12px; }
    p { font-size: 16px; color: #475569; line-height: 1.5; margin-bottom: 24px; }
    .brand { font-size: 14px; color: #94a3b8; margin-top: 24px; }
    .brand strong { color: #0ea5e9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="brand">Gracias por tu preferencia<br><strong>Cubo Polar</strong> — Fábrica de hielo</p>
  </div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
