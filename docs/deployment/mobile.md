# Deploy — Mobile (App Store / Google Play)

Empacotar o jogo web como app nativo iOS/Android. Já existem controles de toque
(`src/ui/TouchControls.ts`). O wrapper nativo pertence a uma fase futura do
[roadmap](../ROADMAP.md), atualmente pausada; não há implementação Capacitor em andamento.

No web mobile já entregue, portrait pausa a partida e mostra o pedido de rotação; landscape retoma
o jogo com joystick, ação e pausa. O fechamento da Fase 3C validou 390×844 e 844×390 em navegador
real/emulado. Isso é comportamento do site/PWA, não bloqueio nativo de orientação.

## Wrapper: Capacitor (recomendado)

[Capacitor](https://capacitorjs.com) embrulha o build web num app nativo com WebView e dá
acesso a APIs do dispositivo. É o caminho mais direto para um jogo web já pronto.

> Confirme comandos/versões na doc oficial ao implementar.

1. Adicionar Capacitor (`@capacitor/core`, `@capacitor/cli`) e inicializar.
2. Definir `webDir: 'dist'` na config do Capacitor.
3. `npm run build && npx cap sync` a cada mudança.
4. Adicionar plataformas: `npx cap add ios` / `npx cap add android`.
5. Abrir em Xcode / Android Studio (`npx cap open ios|android`) para rodar, assinar e publicar.

## Ajustes específicos de mobile

- **Performance é o gargalo.** WebGL em WebView de celular é mais limitado. Já há redução
  automática de qualidade em telas de toque (pixel ratio, tamanho da torcida em `main.ts`).
  Fazer profiling em aparelhos reais de baixo/médio porte na futura fase de render/performance e
  definir orçamento.
- **Orientação:** no web, portrait pausa e landscape joga; ao criar o wrapper, também travar em
  landscape na configuração nativa sem remover o fallback responsivo do site.
- **Safe areas:** respeitar notch/ilha e barras do sistema (`viewport-fit=cover` já está no
  `index.html`; usar `env(safe-area-inset-*)` no CSS dos controles).
- **Áudio:** iOS exige gesto do usuário para iniciar o AudioContext — já tratado (`audio.init()`
  no start), validar no Safari iOS.
- **Ícones e splash:** gerar via ferramenta de assets do Capacitor a partir de um PNG grande.
- **Sem teclado físico:** garantir que todo fluxo é 100% jogável só no toque.

## Ciclo das lojas

| | Apple App Store | Google Play |
|---|---|---|
| Conta | Apple Developer (anual) | Google Play Console (taxa única) |
| Build | Xcode → Archive → App Store Connect | Android Studio → AAB assinado |
| Review | Rigoroso; pode pedir ajustes | Mais rápido, mas com políticas |
| Requisitos | Ícones, privacidade, screenshots por device | Ficha da loja, classificação etária |

## Considerações

- Manter **um único código web**; o específico de mobile fica em CSS de safe-area, config de
  orientação e plugins do Capacitor — não bifurcar a lógica de jogo.
- Avaliar `localStorage` vs plugin de storage nativo do Capacitor para saves.
