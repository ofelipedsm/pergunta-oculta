/**
 * Origens liberadas para o front. CORS_ORIGIN aceita uma lista separada por vírgula.
 * Vazia ou ausente: libera qualquer origem (útil no desenvolvimento e antes de ter o endereço da Vercel).
 */
export function corsOrigin(): string[] | true {
  const list = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length ? list : true;
}

/**
 * WebSocket não passa pela regra de CORS do navegador, então o servidor confere a origem
 * na abertura da conexão. Sem cabeçalho Origin (scripts, testes) a conexão é aceita.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  const allowed = corsOrigin();
  if (allowed === true || !origin) return true;
  return allowed.includes(origin.replace(/\/+$/, ''));
}
