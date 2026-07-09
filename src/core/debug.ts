// Decide se os ganchos de depuração globais (window.__match / window.__renderer) devem ser
// expostos. Em desenvolvimento sempre; no build de produção só com ?debug na URL — mesmo idioma
// do opt-in ?touch=1 já usado no bootstrap. Helper puro (sem DOM) para ficar testável em Node.
export function exporDebugHabilitado(opts: { dev: boolean; search: string }): boolean {
  return opts.dev || new URLSearchParams(opts.search).has('debug');
}
