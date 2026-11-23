# PRD — Tamanho da Arte

> App PWA para tatuadores e clientes medirem a área de uma tatuagem
> antes de executar, usando apenas a câmera do celular.

---

## Problema

Tatuadores precisam saber a área exata (cm²) e as dimensões de uma arte antes
de cotar o serviço. Hoje isso é feito a olho ou com fita métrica — impreciso,
trabalhoso e difícil de comunicar ao cliente remotamente.

## Solução

O usuário fotografa a área da pele, delimita a arte com o dedo e recebe a área
em cm² instantaneamente, com envio direto pelo WhatsApp.

---

## Features

### Feature 1 — Câmera (`CameraCapture.vue`)

**O que faz:** Acessa a câmera traseira do dispositivo e captura uma foto em alta
resolução da superfície a ser tatuada.

**Inputs:** Permissão de câmera do SO.
**Output:** `imageDataUrl` (JPEG base64, resolução máxima disponível).

**Casos de uso:**
- Usuário concede permissão → câmera abre, botão de captura visível
- Usuário nega permissão → mensagem de erro com instruções de como liberar
- Nenhuma câmera encontrada → mensagem de erro adequada
- Captura dispara flash visual e retorna a foto

**Decisões de design:**
- Câmera traseira preferencial (`facingMode: environment`)
- Sem medição de distância — calibração é feita na etapa seguinte
- Uma mão só: botão de captura no centro-baixo

---

### Feature 2 — Calibração de Escala (`CalibrationOverlay.vue` + `useScaleCalibration.js`)

**O que faz:** A partir de dois pontos tocados pelo usuário na foto e uma
distância real informada em cm, calcula `pixelsPerCm` para a imagem capturada.

**Inputs:**
- `imageDataUrl` (da Feature 1)
- 2 toques na foto (posição CSS px relativa à imagem)
- Distância real entre os pontos (inteiro em cm, 1–100)

**Output:** `pixelsPerCm` (number > 0)

**Fórmula central:**
```
scale      = naturalWidth / displayWidth
imgPxDist  = √((dx·scale)² + (dy·scale)²)
ppc        = imgPxDist / realCm
```

**Casos de uso:**
- Usuário toca A e B em pontos conhecidos → informa distância real → confirma
- Usuário erra os pontos → botão "Refazer" recomeça a seleção
- Pontos idênticos → ppc=0 (sem crash); usuário deve refazer
- realCm=0 → ppc=0 protegido (sem divisão por zero)

**Referências de calibração sugeridas na UI:**
- Largura do pulso: ~6 cm
- Largura de um dedo: ~2 cm
- Nó do dedo: ~2,5 cm

---

### Feature 3 — Desenho do Contorno (`TattooCanvas.vue`)

**O que faz:** Exibe a foto capturada e permite ao usuário desenhar o polígono
que delimita a área da arte com o dedo.

**Inputs:**
- `imageDataUrl`
- `pixelsPerCm` (da Feature 2)
- Toques/arrastos do dedo na tela

**Output:** `points[]` (array de vértices em px da imagem original) + `snapshotUrl`

**Casos de uso:**
- Usuário arrastar o dedo → polígono cresce vértice a vértice
- Lupa aparece acima do dedo para precisão
- Levantar o dedo interrompe o traço (permite reposicionamento)
- Botão "Confirmar" exporta o polígono e snapshot

---

### Feature 4 — Cálculo de Área (`useShoelaceArea.js`)

**O que faz:** A partir dos vértices do polígono e do `pixelsPerCm`, calcula
área, bounding box e formata a mensagem WhatsApp.

**Fórmula:** Shoelace (Gauss):
```
areaPixels² = |Σ(xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)| / 2
areaCm²     = areaPixels² / ppc²
```

**Casos de uso:**
- Polígono ≥ 3 vértices → área e bounding box corretos
- Polígono < 3 vértices → área = 0 (sem erro)
- ppc = 0 → área = 0 (sem divisão por zero)
- formatWhatsApp com nome → inclui linha de cliente
- formatWhatsApp sem nome → omite linha de cliente

---

### Feature 5 — Resultado e Compartilhamento (`App.vue` step 4)

**O que faz:** Exibe a área medida, as dimensões e um formulário para enviar
o resultado ao artista via WhatsApp.

**Inputs:** `areaCm2`, `boundingBox`, `snapshotUrl`, nome do cliente, observações, telefone
**Output:** Deep link `wa.me/` com mensagem pré-formatada

**Casos de uso:**
- Usuário preenche nome + phone → link abre WhatsApp para o número do artista
- Sem telefone → link abre WhatsApp para escolha de contato
- "Ajustar Desenho" → volta para Desenho sem perder a foto/escala
- "Nova Medição" → modal de confirmação antes de descartar tudo

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | Vue 3 (Composition API, `<script setup>`) |
| Build | Vite 5 |
| PWA | vite-plugin-pwa (workbox, autoUpdate) |
| Testes | Vitest 2 + @vue/test-utils |
| Deploy | GitHub Pages (Actions CI/CD) |

## Testes

```bash
npm run test:unit          # roda todos os testes
npm run test:unit:coverage # cobertura
npm run test:unit:watch    # modo watch (dev)
```

Cobertura atual: `useShoelaceArea` e `useScaleCalibration` — 100% das branches críticas.

## Arquitetura de pastas

```
src/
  App.vue                          # orquestrador — 4 steps
  components/
    CameraCapture.vue              # Feature 1
    CalibrationOverlay.vue         # Feature 2 (usa useScaleCalibration)
    TattooCanvas.vue               # Feature 3
  composables/
    useShoelaceArea.js             # Feature 4 — lógica pura testada
    useScaleCalibration.js         # Feature 2 — cálculo puro testado
    useARCamera.js                 # legado (não usado em produção)
    useDepthScale.js               # legado (não usado em produção)
    __tests__/
      useShoelaceArea.test.js      # 9 testes
      useScaleCalibration.test.js  # 6 testes
```

## Próximas features (backlog)

- [ ] Histórico de medições (localStorage)
- [ ] Múltiplos polígonos na mesma foto
- [ ] Export PDF com a foto anotada
- [ ] Comparar com arte existente (segunda foto de referência)
