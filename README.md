# ArtMeasure

Aplicação Web PWA para medir áreas de tatuagem usando uma foto com objeto de referência.

## Stack

- Vue 3 (Composition API + `<script setup>`)
- Vite 5
- vite-plugin-pwa (Service Worker + manifesto)
- CSS Scoped (dark mode `#0f172a`)
- 100% client-side, sem servidor

## Como usar

```bash
npm install      # instala deps + gera ícones automaticamente
npm run dev      # inicia servidor de dev em http://localhost:5173
npm run build    # gera o dist/ para produção
npm run preview  # pré-visualiza o build
```

## Fluxo da aplicação

| Passo | O que acontece |
|-------|----------------|
| **0 – Upload** | Foto da câmera (`capture="environment"`) ou galeria; demo gerada por canvas |
| **1 – Calibração** | Círculo interativo (arrasta + redimensiona) sobre moeda/cartão; calcula `pixelsPerCm` |
| **2 – Desenho** | Risca o contorno com lupa 2.2× posicionada 110 px acima do polegar |
| **3 – Orçamento** | Card com cm², W×H, formulário + botão WhatsApp (`wa.me`) |

## Algoritmos

- **Shoelace (Gauss)** para área do polígono em pixels²
- Conversão: `areaCm² = areaPixels² / pixelsPerCm²`
- **Bounding Box** (min/max X,Y) para largura e altura
- Suavização de traço via **Quadratic Bézier** (pontos médios)
- **Lupa** via `drawImage` recortado e reescalado no canvas

## Deploy no GitHub Pages

1. Fork / push para um repositório no GitHub
2. Vá em **Settings → Pages → Source: GitHub Actions**
3. Qualquer push na branch `main` dispara o workflow `.github/workflows/deploy.yml`
4. A URL será `https://<user>.github.io/<repo>/`

> O `base: './'` no `vite.config.js` garante que assets funcionem em qualquer subcaminho.

## Objetos de referência suportados

| Objeto | Diâmetro/largura real |
|--------|-----------------------|
| Moeda R$ 1,00 | 2,70 cm |
| Moeda R$ 0,50 | 2,30 cm |
| Moeda R$ 0,25 | 2,50 cm |
| Cartão de Crédito | 8,56 cm |
| Personalizado | qualquer valor em cm |
