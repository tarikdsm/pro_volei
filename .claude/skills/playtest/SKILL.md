---
name: playtest
description: Use when gameplay, rendering, input, audio, world, or UI changes in Pró Volei require verification in a real browser.
---

# Playtest do Pró Volei

## Visão geral

Exercite o jogo no Playwright MCP e observe comportamento, visual e console. O playtest complementa
os gates automatizados; não substitui `npm run check` nem os E2E.

## Referência rápida

| Perfil | URL | Fluxo e controles |
|---|---|---|
| Desktop alto | `/?debug=1&tier=2` | Clique em **JOGAR**; **Setas** movem/miram, **Espaço** age, **Esc** pausa |
| Touch landscape | `/?debug=1&touch=1&tier=1` | Autostart sem **JOGAR**; ação no terço esquerdo, joystick no terço direito |
| Touch portrait | mesma URL, viewport vertical | Menu “Gire o celular”; simulação pausada até voltar ao landscape |

## Procedimento

1. Confirme que as ferramentas `mcp__playwright__*` estão disponíveis.
2. Escolha uma porta livre e suba Vite em background com host `127.0.0.1` e `--strictPort`. Grave
   stdout/stderr em `.playwright-mcp/` e aguarde a linha `ready`. Não presuma 5173 ou 5199 livres.
3. Abra o perfil relevante. Capture menu, saque/rally e o estado alterado; use viewport desktop e,
   para mudanças móveis, pelo menos 844×390 e 390×844.
4. Jogue alguns rallies. No saque, segure/solte **Espaço** ou a zona de ação e mire pelas
   **Setas** ou pelo joystick. Verifique HUD, bola, atleta controlada, touch simultâneo e pausa.
5. Leia erros e avisos do console da navegação corrente. Mensagens acumuladas de outra URL/porta
   devem ser classificadas separadamente, nunca atribuídas ao run atual.
6. Inspecione estado pelos hooks abaixo quando a observação visual não bastar.
7. Se houver falha, use `superpowers:systematic-debugging` antes de propor correção.
8. Ao terminar, localize o PID que escuta a porta, confirme que a linha de comando aponta para o
   Vite deste repositório e só então encerre esse processo. Nunca mate todos os processos Node.

## Hooks de diagnóstico

Com `?debug=1` (ou em DEV), estão disponíveis:

- `window.__match`, `window.__renderer`, `window.__simulationClock` e `window.__controlFrame`;
- `window.__selection`, `window.__action`, `window.__cameraFrame` e `window.__feedback`;
- `window.__seed`, `window.__random`, `window.__readJournal()` e os snapshots de journal.

Use `__simulationClock.tick` para provar avanço/congelamento e `__renderer.info.render` para draw
calls/triângulos. Hooks debug não existem no build público sem `?debug=1`.

## Erros comuns

- Usar WASD: o contrato atual é **Setas + Espaço**.
- Inverter touch: **ação à esquerda; movimento à direita**.
- Procurar **JOGAR** no touch landscape: esse fluxo inicia automaticamente.
- Salvar screenshots na raiz: use `.playwright-mcp/` e não suje o Git.
- Reportar “sem erros” sem verificar console e progressão real do tick.
