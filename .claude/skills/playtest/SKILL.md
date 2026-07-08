---
name: playtest
description: Sobe o Pró Volei e o exercita num browser real via Playwright MCP — abre o jogo, inicia uma partida, tira screenshots e lê erros do console. Use após mudanças em game/, entities/, systems/, world/ ou ui/ para verificar comportamento de verdade, não só testes unitários.
---

# Playtest — verificar o Pró Volei num browser real

Confirma que o jogo carrega e que a mudança funciona, dirigindo o jogo de ponta a ponta.
Complementa (não substitui) os testes de `npm run test`.

## Pré-requisitos

- **Playwright MCP ativo** (configurado em `.mcp.json`). Se as ferramentas `mcp__playwright__*`
  não estiverem disponíveis, peça ao usuário para aprovar/reiniciar o MCP e pare aqui.

## Passos

1. **Suba o dev server em background:** `npm run dev` (porta 5173). Aguarde a linha `ready`.
2. **Abra o jogo:** navegue até `http://localhost:5173/`.
   - Para testar os controles de toque no desktop, use `http://localhost:5173/?touch=1`.
3. **Screenshot do menu inicial.**
4. **Verifique o console** (mensagens do browser). Qualquer erro/exceção = investigar antes de seguir.
5. **Inicie uma partida:** clique em jogar (dificuldade Normal, formato rápido).
6. **Jogue alguns rallies** pelo teclado:
   - Saque: segurar e soltar **Espaço**; mira com **WASD**.
   - Recepção/ataque/bloqueio: **WASD** move/mira, **Espaço** no tempo do toque/pulo.
   - Capture screenshots em momentos-chave (saque, rally, ponto).
7. **Reporte:** carregou sem erro de console? a mudança apareceu/funcionou como esperado?
   Anexe screenshots (antes/depois quando fizer sentido).

## Encerrar

- **Pare o dev server** em background ao terminar (não deixe a porta presa).
- Salve screenshots dentro de `.playwright-mcp/` (já ignorado pelo git) para não sujar a raiz
  do repositório; limpe qualquer artefato que tenha escapado.

## Dica de porta

Se a porta padrão (5173) estiver ocupada por outro projeto, suba numa porta dedicada com
`npm run dev -- --port 5199 --strictPort` e navegue para `http://localhost:5199/`.

## Dicas

- `window.__match` no console expõe o estado da partida para inspeção/depuração.
- Se o comportamento estiver errado, use a skill `superpowers:systematic-debugging` para achar
  a causa raiz antes de propor conserto.
- Performance é crítica no alvo mobile — repare em travadas/queda de FPS durante rallies longos.
