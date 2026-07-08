# Deploy — Web

O alvo primário. Build estático, servível em qualquer host de arquivos.

## Build

```bash
npm run build     # gera dist/ (estático, ~150 kB gzip)
npm run preview   # confere o build localmente
```

`vite.config.ts` usa `base: './'` — caminhos relativos, então funciona em subdiretório
(GitHub Pages em `/pro_volei/`) ou na raiz de um domínio.

## GitHub Pages (atual)

```bash
npm run deploy    # build + publica dist/ na branch gh-pages (pacote gh-pages)
```

Publica em `https://tarikdsm.github.io/pro_volei/`.

### Opcional: deploy contínuo por Actions

Em vez do deploy manual, um workflow pode publicar no Pages a cada push em `main` (após o CI
verde), usando `actions/deploy-pages`. Colocar isso na Fase 4 do roadmap.

## itch.io

Alternativa popular para jogos web: suba o `dist/` como zip (HTML5), marque como jogável no
browser, defina a resolução da janela. Bom para alcançar jogadores e receber feedback.

## Checklist de qualidade web

- [ ] Tela de carregamento enquanto o WebGL inicializa
- [ ] `<meta>` de PWA + manifest para "instalar" e rodar em tela cheia
- [ ] Testar em Chrome, Firefox, Safari (desktop e iOS Safari)
- [ ] Verificar caça a memória em sessões longas (a torcida instanciada é o maior custo)

> Este mesmo `dist/` é a base dos wrappers de [Desktop/Steam](desktop-steam.md) e
> [Mobile](mobile.md) — mantenha o build web saudável e todos se beneficiam.
