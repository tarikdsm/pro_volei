# Deploy — Desktop / Steam

Empacotar o jogo web como app nativo de PC (Windows/macOS/Linux) e publicar na Steam.
Planejado para a **Fase 4** do [roadmap](../ROADMAP.md).

## Escolha do wrapper: Tauri (recomendado)

| | Tauri | Electron |
|---|---|---|
| Tamanho do binário | ~poucos MB (usa o webview do SO) | ~100+ MB (embute Chromium) |
| Consumo de memória | Baixo | Alto |
| Webview | Sistema (WebView2/WKWebView/WebKitGTK) | Chromium fixo |
| Backend | Rust | Node.js |

Para um jogo WebGL leve e offline, **Tauri** dá binários menores e melhor uso de memória.
O ponto de atenção é que o webview do SO varia entre máquinas — **testar a performance WebGL
em cada plataforma** antes de fechar a decisão. Se aparecer inconsistência de GPU, Electron
(Chromium fixo) é o plano B.

## Passos (alto nível)

> Confirme os comandos/versões atuais na doc oficial do Tauri v2 ao implementar
> (a API evolui): <https://tauri.app>.

1. Adicionar Tauri ao projeto (`@tauri-apps/cli`) e inicializar (`tauri init`).
2. Apontar o `frontendDist` para o `dist/` do Vite e o `devUrl` para `http://localhost:5173`.
3. Ícones do app (`tauri icon`) a partir de um PNG de alta resolução.
4. `tauri dev` para rodar nativo; `tauri build` para gerar instaladores
   (`.msi`/`.exe`, `.dmg`, `.AppImage`/`.deb`).
5. Assinatura de código (Windows/macOS) para evitar avisos de segurança — exige certificados.

## Integração Steam

1. Conta Steamworks (taxa única por app) e criação do app na plataforma.
2. Integrar o SDK Steamworks (achievements, cloud saves, overlay) — via crate Rust do lado
   Tauri ou binding equivalente. Começar sem SDK (só o executável) é válido para um MVP.
3. Configurar depots e a build tool do Steam (`steamcmd`) para subir os binários por plataforma.
4. Página da loja: capsule art, screenshots, trailer, descrição, tags, preço.
5. Passar pelo review da Valve.

## Considerações

- **Input:** já há teclado; adicionar **suporte a gamepad** (Gamepad API) é quase obrigatório
  no PC/Steam. Encaixa na Fase 2.
- **Tela cheia e resolução:** expor opção de fullscreen/resolução no menu de opções.
- **Salvamento:** usar diretório de dados do app (via API do Tauri) em vez de `localStorage`
  quando fizer sentido para saves robustos.
